import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { accessToken, list, loadOAuth, openSession, saveOAuth } from "./erp.ts";
import { profileNamesFor } from "./models.ts";

/**
 * What does the ERP say about a load? Any active Stacker member may ask.
 *
 * POST { load_no }             -> { load, trailers, parts_orders, summary, compare }
 * POST { open: true, from, to } -> { loads: [...] }   open ERP loads by planned ship date
 *
 * load      customer, ship_date, carrier, ltype ("stack" | "semi"), cust_pickup, notes
 * trailers  one per trailer on the load: serial, model, built?, weight, and the stack drawing it uses
 * compare   what the ERP ordered vs what is placed on the saved Stacker load with this number
 * Read only: nothing is written to the ERP or to rs_loads.
 */
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const day = (s: unknown) => (typeof s === "string" && s.length >= 10 ? s.slice(0, 10) : "");

type ErpLoad = { load_number: string; customer: string; customer_name: string; carrier: string; carrier_description: string; date_planned_ship: string | null; status: string; order_count: number; load_notes: string | null };
type ErpOrder = { load_number: string; sales_order: number; serial_number: string | null; model_code: string; model_description: string; production_status: string | null; dry_weight: number | null; date_due: string | null };

function headOf(l: ErpLoad) {
  const carrier = (l.carrier ?? "").toUpperCase();
  return {
    load_no: l.load_number,
    customer: (l.customer_name ?? "").trim(),
    customer_code: l.customer,
    ship_date: day(l.date_planned_ship),
    carrier,
    carrier_description: l.carrier_description ?? "",
    // STK loads ride on their own bottom trailer; CPU is the customer's own truck; anything else is a booked semi.
    ltype: carrier === "STK" || carrier === "CPU" ? "stack" : "semi",
    cust_pickup: carrier === "CPU",
    notes: (l.load_notes ?? "").trim(),
    erp_status: l.status === "C" ? "closed" : "open",
    order_count: l.order_count ?? 0,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("authorization") ?? "" } } });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return json({ error: "sign in first" }, 401);
  const { data: m } = await supabase.from("rs_members").select("active").eq("user_id", userData.user.id).maybeSingle();
  if (!m?.active) return json({ error: "not a Stacker member" }, 403);

  const body = (await req.json().catch(() => ({}))) as { load_no?: string; open?: boolean; from?: string; to?: string };

  let call: Awaited<ReturnType<typeof openSession>>;
  try {
    call = await openSession(await accessToken(supabase, await loadOAuth(supabase)));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return json({ error, connected: !error.startsWith("ERP is not connected") }, 503);
  }

  try {
    if (body.open) {
      const args: Record<string, unknown> = { status: "O", limit: 200 };
      if (body.from) args.planned_ship_from = body.from;
      if (body.to) args.planned_ship_to = body.to;
      const loads = list<ErpLoad>(await call("list_truck_loads", args)).map(headOf);
      await saveOAuth(supabase, { last_ok_at: new Date().toISOString(), last_error: null });
      return json({ loads });
    }

    const loadNo = String(body.load_no ?? "").trim();
    if (!/^[A-Za-z0-9-]{3,12}$/.test(loadNo)) return json({ error: "load number?" }, 400);
    const stops = list<ErpLoad>(await call("list_truck_loads", { load_number: loadNo, limit: 5 }));
    if (stops.length === 0) {
      await saveOAuth(supabase, { last_ok_at: new Date().toISOString(), last_error: null });
      return json({ found: false, load: null, trailers: [] });
    }
    const orders = list<ErpOrder>(await call("list_sales_orders_on_truck_loads", { load_number: loadNo, limit: 100 }));
    await saveOAuth(supabase, { last_ok_at: new Date().toISOString(), last_error: null });

    // Which stack drawing each model uses: an override row wins, then the naming rules.
    const [{ data: profiles }, { data: overrides }, { data: saved }] = await Promise.all([
      supabase.from("rs_profiles").select("id,name,kind").neq("kind", "truck"),
      supabase.from("rs_model_map").select("model_code,profile_id"),
      supabase.from("rs_loads").select("id,placements").eq("load_no", loadNo).limit(1),
    ]);
    const byName = new Map((profiles ?? []).map((p) => [norm(p.name as string), p]));
    const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
    const over = new Map((overrides ?? []).map((o) => [o.model_code as string, o.profile_id as string]));
    const profileFor = (code: string) => {
      const o = over.get(code);
      if (o && byId.has(o)) return byId.get(o)!;
      for (const n of profileNamesFor(code)) if (byName.has(norm(n))) return byName.get(norm(n))!;
      return null;
    };

    const partsOrders = orders.filter((o) => o.model_code === "PARTS");
    const trailers = orders.filter((o) => o.model_code !== "PARTS").map((o) => {
      const p = profileFor(o.model_code);
      const status = o.production_status ?? "";
      return {
        serial: o.serial_number ?? "", sales_order: o.sales_order, model_code: o.model_code, description: o.model_description,
        production_status: status, built: status === "Completed" || status === "Stock",
        dry_weight: o.dry_weight ?? null, profile_id: (p?.id as string) ?? null, profile_name: (p?.name as string) ?? null,
      };
    });

    // Ordered vs placed, by drawing. Truck decks are not trailers and do not count.
    let compare: unknown = null;
    if (saved?.[0]) {
      const placed = new Map<string, number>();
      for (const pl of (saved[0].placements as { profileId: string }[]) ?? []) if (byId.has(pl.profileId)) placed.set(pl.profileId, (placed.get(pl.profileId) ?? 0) + 1);
      const want = new Map<string, number>();
      for (const t of trailers) if (t.profile_id) want.set(t.profile_id, (want.get(t.profile_id) ?? 0) + 1);
      const name = (id: string) => (byId.get(id)?.name as string) ?? id;
      const missing = [...want].filter(([id, n]) => n > (placed.get(id) ?? 0)).map(([id, n]) => ({ profile_id: id, profile_name: name(id), count: n - (placed.get(id) ?? 0) }));
      const extra = [...placed].filter(([id, n]) => n > (want.get(id) ?? 0)).map(([id, n]) => ({ profile_id: id, profile_name: name(id), count: n - (want.get(id) ?? 0) }));
      const placedTotal = [...placed.values()].reduce((a, b) => a + b, 0);
      compare = { stacker_load_id: saved[0].id, ordered: trailers.length, placed: placedTotal, unmapped: trailers.filter((t) => !t.profile_id).length, missing, extra, matches: missing.length === 0 && extra.length === 0 && placedTotal === trailers.length };
    }

    return json({
      found: true,
      load: headOf(stops[0]),
      trailers,
      parts_orders: partsOrders.length,
      summary: { trailers: trailers.length, built: trailers.filter((t) => t.built).length, dry_weight: trailers.reduce((a, t) => a + (t.dry_weight ?? 0), 0) },
      compare,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await saveOAuth(supabase, { last_error: error.slice(0, 300) }).catch(() => {});
    return json({ error }, 502);
  }
});
