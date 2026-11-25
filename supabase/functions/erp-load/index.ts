import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { accessToken, list, loadOAuth, openSession, saveOAuth, sha256hex } from "./erp.ts";
import { profileNamesFor } from "./models.ts";

/**
 * Keeps public.rs_erp_loads in step with the ERP. Any active Stacker member may call it.
 *
 * POST { load_no }       refresh one load and return its row
 * POST { sync: true }    refresh every open ERP load shipping from 45 days back to 90 days out, plus
 *                        any load Stacker is still working on. Skipped when the last sync is under
 *                        10 minutes old unless { force: true }.
 *
 * Each row: head (customer, ship_date, carrier, ltype, cust_pickup, notes, erp_status) and trailers
 * (serial, model, production stage in plain words, weight, and the stack drawing the model uses).
 * Read only on the ERP side. Stacker's own loads (rs_loads) are never touched.
 */
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-setup-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const day = (s: unknown) => (typeof s === "string" && s.length >= 10 ? s.slice(0, 10) : "");
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400_000).toISOString().slice(0, 10);

type ErpLoad = { load_number: string; customer: string; customer_name: string; carrier: string; carrier_description: string; date_planned_ship: string | null; status: string; order_count: number; load_notes: string | null };
type ErpOrder = { load_number: string; sales_order: number; serial_number: string | null; model_code: string; model_description: string; production_status: string | null; dry_weight: number | null };
type Profile = { id: string; name: string };

function headOf(l: ErpLoad) {
  const carrier = (l.carrier ?? "").toUpperCase();
  return {
    load_no: l.load_number,
    customer: (l.customer_name ?? "").trim(),
    customer_code: l.customer,
    ship_date: day(l.date_planned_ship),
    carrier,
    carrier_description: l.carrier_description ?? "",
    // STK rides on its own bottom trailer and CPU is the customer's truck; DDK and SEMI are booked semis.
    ltype: carrier === "STK" || carrier === "CPU" ? "stack" : "semi",
    cust_pickup: carrier === "CPU",
    notes: (l.load_notes ?? "").trim(),
    erp_status: l.status === "C" ? "closed" : "open",
    order_count: l.order_count ?? 0,
  };
}

/** The ERP's production status in words for someone who is not on the floor. */
function stageOf(status: string): { stage: "done" | "wip" | "todo"; label: string } {
  const s = status.trim();
  if (s === "Completed") return { stage: "done", label: "Finished" };
  if (s === "Stock") return { stage: "done", label: "In stock" };
  if (s === "" || s === "No Order") return { stage: "todo", label: "Not released yet" };
  if (s === "Released") return { stage: "todo", label: "Released, not started" };
  // Anything else is the work center the trailer is at, e.g. "WELDING ASSEMBLY".
  return { stage: "wip", label: "In " + s.toLowerCase() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Caller: an active member, or a one-time setup key (used once to prime the cache).
  const setupKey = req.headers.get("x-setup-key") ?? "";
  let allowed = false;
  if (setupKey.length >= 20) {
    const { data: used } = await supabase.from("erp_setup_key").update({ used_at: new Date().toISOString() })
      .eq("hash", await sha256hex(setupKey)).is("used_at", null).gt("expires_at", new Date().toISOString()).select("hash");
    allowed = Boolean(used?.length);
  } else {
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("authorization") ?? "" } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) return json({ error: "sign in first" }, 401);
    const { data: m } = await supabase.from("rs_members").select("active").eq("user_id", userData.user.id).maybeSingle();
    allowed = Boolean(m?.active);
  }
  if (!allowed) return json({ error: "not allowed" }, 403);

  const body = (await req.json().catch(() => ({}))) as { load_no?: string; sync?: boolean; force?: boolean };

  if (body.sync && !body.force) {
    const { data: last } = await supabase.from("rs_erp_sync").select("*").eq("id", 1).maybeSingle();
    const age = (t: string | null) => (t ? Date.now() - new Date(t).getTime() : Infinity);
    if (last && age(last.finished_at) < 10 * 60_000 && !last.error) return json({ fresh: true, finished_at: last.finished_at, loads: last.loads });
    if (last && age(last.started_at) < 3 * 60_000 && age(last.started_at) < age(last.finished_at)) return json({ busy: true });
  }

  let call: Awaited<ReturnType<typeof openSession>>;
  try {
    call = await openSession(await accessToken(supabase, await loadOAuth(supabase)));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return json({ error, connected: !error.startsWith("ERP is not connected") }, 503);
  }

  // Which stack drawing each model uses: an override row wins, then the naming rules.
  const [{ data: profiles }, { data: overrides }] = await Promise.all([
    supabase.from("rs_profiles").select("id,name,kind").neq("kind", "truck"),
    supabase.from("rs_model_map").select("model_code,profile_id"),
  ]);
  const byName = new Map(((profiles ?? []) as Profile[]).map((p) => [norm(p.name), p]));
  const byId = new Map(((profiles ?? []) as Profile[]).map((p) => [p.id, p]));
  const over = new Map((overrides ?? []).map((o) => [o.model_code as string, o.profile_id as string]));
  const profileFor = (code: string): Profile | null => {
    const o = over.get(code);
    if (o && byId.has(o)) return byId.get(o)!;
    for (const n of profileNamesFor(code)) if (byName.has(norm(n))) return byName.get(norm(n))!;
    return null;
  };

  const rowFor = async (head: ReturnType<typeof headOf>) => {
    const orders = list<ErpOrder>(await call("list_sales_orders_on_truck_loads", { load_number: head.load_no, limit: 100 }));
    const trailers = orders.filter((o) => o.model_code !== "PARTS").map((o) => {
      const p = profileFor(o.model_code);
      return {
        serial: o.serial_number ?? "", sales_order: o.sales_order, model_code: o.model_code, description: o.model_description,
        ...stageOf(o.production_status ?? ""), status: o.production_status ?? "",
        dry_weight: o.dry_weight ?? null, profile_id: p?.id ?? null, profile_name: p?.name ?? null,
      };
    });
    return { load_no: head.load_no, head, trailers, parts_orders: orders.length - trailers.length, fetched_at: new Date().toISOString() };
  };

  try {
    if (!body.sync) {
      const loadNo = String(body.load_no ?? "").trim();
      if (!/^[A-Za-z0-9-]{3,12}$/.test(loadNo)) return json({ error: "load number?" }, 400);
      const stops = list<ErpLoad>(await call("list_truck_loads", { load_number: loadNo, limit: 5 }));
      await saveOAuth(supabase, { last_ok_at: new Date().toISOString(), last_error: null });
      if (stops.length === 0) return json({ found: false });
      const row = await rowFor(headOf(stops[0]));
      await supabase.from("rs_erp_loads").upsert(row);
      return json({ found: true, row });
    }

    const started = Date.now();
    await supabase.from("rs_erp_sync").update({ started_at: new Date().toISOString() }).eq("id", 1);
    const heads = new Map<string, ReturnType<typeof headOf>>();
    for (let offset = 0; offset < 2000; offset += 500) {
      const page = list<ErpLoad>(await call("list_truck_loads", { status: "O", planned_ship_from: iso(-45), planned_ship_to: iso(90), limit: 500, offset }));
      for (const l of page) if (!heads.has(l.load_number)) heads.set(l.load_number, headOf(l));
      if (page.length < 500) break;
    }
    // Loads Stacker is still working on, even when they fall outside that window or are closed in the ERP.
    const { data: mine } = await supabase.from("rs_loads").select("load_no").neq("status", "picked");
    for (const m of mine ?? []) {
      const no = String(m.load_no ?? "").trim();
      if (!/^[A-Za-z0-9-]{3,12}$/.test(no) || heads.has(no)) continue;
      const stops = list<ErpLoad>(await call("list_truck_loads", { load_number: no, limit: 5 }));
      if (stops[0]) heads.set(no, headOf(stops[0]));
    }

    const todo = [...heads.values()];
    const rows: Awaited<ReturnType<typeof rowFor>>[] = [];
    let failed = 0;
    const worker = async () => {
      for (let h = todo.pop(); h; h = todo.pop()) {
        try { rows.push(await rowFor(h)); } catch { try { rows.push(await rowFor(h)); } catch { failed++; } }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from("rs_erp_loads").upsert(rows.slice(i, i + 100));
      if (error) throw new Error("save: " + error.message);
    }
    // Loads the ERP no longer lists as open drop out of the picker; keep them a week for loads still on the board.
    await supabase.from("rs_erp_loads").delete().lt("fetched_at", new Date(Date.now() - 7 * 86400_000).toISOString());
    const finished = new Date().toISOString();
    await supabase.from("rs_erp_sync").update({ finished_at: finished, loads: rows.length, error: failed ? `${failed} loads could not be read` : null }).eq("id", 1);
    await saveOAuth(supabase, { last_ok_at: finished, last_error: null });
    return json({ ok: true, loads: rows.length, failed, took_ms: Date.now() - started, finished_at: finished });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await saveOAuth(supabase, { last_error: error.slice(0, 300) }).catch(() => {});
    if (body.sync) await supabase.from("rs_erp_sync").update({ finished_at: new Date().toISOString(), error: error.slice(0, 300) }).eq("id", 1);
    return json({ error }, 502);
  }
});
