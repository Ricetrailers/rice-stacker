import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ERP_AUTHORIZE, ERP_MCP, ensureClient, exchangeCode, loadOAuth, pkce, sha256hex, storeTokens } from "./erp.ts";

/**
 * "Connect ERP" for Rice Stacker.
 *   POST /erp-auth/start            signed-in admin -> { url } to open
 *   GET  /erp-auth/start?key=...    one-time setup link (key hash in erp_setup_key) -> redirects to Metasystems
 *   GET  /erp-auth/callback         exchanges the code, stores the tokens, sends the admin back to the app
 *   POST /erp-auth/status           signed-in member -> { connected, last_ok_at, last_error }
 * Tokens live in public.erp_oauth, which only the service role can read.
 */
const APP_URL = "https://rice-stacker.netlify.app";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const service = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/erp-auth/callback`;

async function member(req: Request, supabase: ReturnType<typeof service>): Promise<{ id: string; role: string } | null> {
  const auth = req.headers.get("authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data } = await userClient.auth.getUser();
  if (!data.user) return null;
  const { data: m } = await supabase.from("rs_members").select("role,active").eq("user_id", data.user.id).maybeSingle();
  return m?.active ? { id: data.user.id, role: m.role as string } : null;
}

async function authorizeUrl(supabase: ReturnType<typeof service>, userId: string | null): Promise<string> {
  const row = await loadOAuth(supabase);
  const clientId = await ensureClient(supabase, row, redirectUri());
  const { verifier, challenge } = pkce();
  const state = crypto.randomUUID();
  await supabase.from("erp_oauth_state").delete().lt("created_at", new Date(Date.now() - 3600_000).toISOString());
  await supabase.from("erp_oauth_state").insert({ state, verifier, user_id: userId });
  const u = new URL(ERP_AUTHORIZE);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", await challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", ERP_MCP);
  return u.toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const supabase = service();

  if (url.pathname.endsWith("/callback")) {
    const back = (msg: string) => Response.redirect(`${APP_URL}/?erp=${encodeURIComponent(msg)}`, 302);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (url.searchParams.get("error")) return back(`error: ${url.searchParams.get("error")}`);
    if (!code || !state) return back("error: missing code");
    const { data: pending } = await supabase.from("erp_oauth_state").select("*").eq("state", state).maybeSingle();
    if (!pending) return back("error: sign-in expired, try again");
    await supabase.from("erp_oauth_state").delete().eq("state", state);
    try {
      const tokens = await exchangeCode(await loadOAuth(supabase), code, pending.verifier as string, redirectUri());
      await storeTokens(supabase, tokens, { connected_by: pending.user_id, connected_at: new Date().toISOString(), refreshing_until: null });
      return back("connected");
    } catch (e) {
      const msg = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 180);
      await supabase.from("erp_oauth").update({ last_error: msg }).eq("id", "metasystems");
      return back(msg);
    }
  }

  if (url.pathname.endsWith("/start") && req.method === "GET") {
    const key = url.searchParams.get("key") ?? "";
    if (key.length < 20) return new Response("not found", { status: 404 });
    const { data: used } = await supabase.from("erp_setup_key").update({ used_at: new Date().toISOString() })
      .eq("hash", await sha256hex(key)).is("used_at", null).gt("expires_at", new Date().toISOString()).select("hash");
    if (!used?.length) return new Response("This setup link has expired or was already used.", { status: 403 });
    try {
      return Response.redirect(await authorizeUrl(supabase, null), 302);
    } catch (e) {
      return new Response("Could not start the ERP sign-in: " + (e instanceof Error ? e.message : String(e)), { status: 500 });
    }
  }

  if (url.pathname.endsWith("/start") && req.method === "POST") {
    const m = await member(req, supabase);
    if (!m) return json({ error: "sign in first" }, 401);
    if (m.role !== "admin") return json({ error: "admins only" }, 403);
    try {
      return json({ url: await authorizeUrl(supabase, m.id) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  if (url.pathname.endsWith("/status") && req.method === "POST") {
    if (!(await member(req, supabase))) return json({ error: "sign in first" }, 401);
    const { data } = await supabase.from("erp_oauth").select("refresh_token,connected_at,last_ok_at,last_error").eq("id", "metasystems").maybeSingle();
    return json({ connected: Boolean(data?.refresh_token), connected_at: data?.connected_at ?? null, last_ok_at: data?.last_ok_at ?? null, last_error: data?.last_error ?? null });
  }

  return new Response("not found", { status: 404, headers: cors });
});
