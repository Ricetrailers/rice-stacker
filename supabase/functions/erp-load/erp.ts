/**
 * Talks to the Metasystems ERP through its MCP endpoint (agent.metasystems.com/mcp) using the
 * OAuth tokens an admin obtained with "Connect ERP". Same approach as the inspection app.
 * MCP over HTTP is JSON-RPC: initialize, then tools/call. Responses may come as SSE.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const ERP_ORIGIN = "https://agent.metasystems.com";
export const ERP_MCP = `${ERP_ORIGIN}/mcp`;
export const ERP_TOKEN = `${ERP_ORIGIN}/api/oauth/token`;
export const ERP_REGISTER = `${ERP_ORIGIN}/api/oauth/register`;
export const ERP_AUTHORIZE = `${ERP_ORIGIN}/oauth/authorize`;
const NOT_CONNECTED = "ERP is not connected. An admin needs to use Connect ERP.";

export type OAuthRow = {
  id: string; client_id: string | null; client_secret: string | null; access_token: string | null;
  refresh_token: string | null; expires_at: string | null; last_error: string | null;
};

export async function loadOAuth(supabase: SupabaseClient): Promise<OAuthRow> {
  const { data, error } = await supabase.from("erp_oauth").select("*").eq("id", "metasystems").maybeSingle();
  if (error) throw new Error("erp_oauth: " + error.message);
  return (data as OAuthRow | null) ?? { id: "metasystems", client_id: null, client_secret: null, access_token: null, refresh_token: null, expires_at: null, last_error: null };
}

export async function saveOAuth(supabase: SupabaseClient, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("erp_oauth").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", "metasystems");
  if (error) throw new Error("erp_oauth save: " + error.message);
}

/** Register this server as an OAuth client once (dynamic client registration). */
export async function ensureClient(supabase: SupabaseClient, row: OAuthRow, redirectUri: string): Promise<string> {
  if (row.client_id) return row.client_id;
  const res = await fetch(ERP_REGISTER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Rice Stacker", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
  });
  if (!res.ok) throw new Error(`register: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { client_id: string; client_secret?: string };
  await saveOAuth(supabase, { client_id: body.client_id, client_secret: body.client_secret ?? null });
  return body.client_id;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };

export async function exchangeCode(row: OAuthRow, code: string, verifier: string, redirectUri: string): Promise<TokenResponse> {
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: row.client_id!, code_verifier: verifier, resource: ERP_MCP });
  if (row.client_secret) form.set("client_secret", row.client_secret);
  const res = await fetch(ERP_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isFresh = (row: OAuthRow) => Boolean(row.access_token && row.expires_at && new Date(row.expires_at).getTime() - Date.now() > 5 * 60_000);

/**
 * A valid access token, refreshed a few minutes before it expires. Only one request refreshes
 * at a time: Metasystems rotates the refresh token on every use, so two refreshing together
 * would leave the second one holding a dead token.
 */
export async function accessToken(supabase: SupabaseClient, row: OAuthRow): Promise<string> {
  if (!row.refresh_token) throw new Error(NOT_CONNECTED);
  if (isFresh(row)) return row.access_token!;

  let claimed = false;
  for (let i = 0; i < 30 && !claimed; i++) {
    const { data } = await supabase.rpc("erp_claim_refresh");
    claimed = data === true;
    if (claimed) break;
    await sleep(400);
    const latest = await loadOAuth(supabase);
    if (isFresh(latest)) return latest.access_token!;
    if (!latest.refresh_token) throw new Error(NOT_CONNECTED);
  }
  if (!claimed) throw new Error("ERP token refresh is busy. Try again.");

  try {
    const current = await loadOAuth(supabase);
    if (isFresh(current)) return current.access_token!;
    if (!current.refresh_token) throw new Error(NOT_CONNECTED);
    const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refresh_token, client_id: current.client_id ?? "", resource: ERP_MCP });
    if (current.client_secret) form.set("client_secret", current.client_secret);
    const res = await fetch(ERP_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      const stillValid = current.access_token && current.expires_at && new Date(current.expires_at).getTime() - Date.now() > 15_000;
      if (res.status === 400 || res.status === 401) {
        await saveOAuth(supabase, { refresh_token: null, access_token: null, last_error: `Disconnected ${new Date().toISOString()}: Metasystems refused the token refresh (${res.status} ${text}).` });
        throw new Error(NOT_CONNECTED);
      }
      if (stillValid) return current.access_token!;
      throw new Error(`refresh: ${res.status} ${text}`);
    }
    const body = (await res.json()) as TokenResponse;
    await storeTokens(supabase, body);
    return body.access_token;
  } finally {
    await supabase.from("erp_oauth").update({ refreshing_until: null }).eq("id", "metasystems");
  }
}

export async function storeTokens(supabase: SupabaseClient, body: TokenResponse, extra: Record<string, unknown> = {}): Promise<void> {
  const patch: Record<string, unknown> = { access_token: body.access_token, expires_at: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(), last_error: null, ...extra };
  if (body.refresh_token) patch.refresh_token = body.refresh_token;
  await saveOAuth(supabase, patch);
}

/** Read one JSON-RPC response, whether it came back as JSON or as an SSE stream. */
async function readRpc(res: Response): Promise<Record<string, unknown>> {
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (type.includes("text/event-stream")) {
    for (const ev of text.split(/\n\n+/)) {
      const data = ev.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (!data) continue;
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        if ("result" in parsed || "error" in parsed) return parsed;
      } catch { /* keep looking */ }
    }
    throw new Error("no JSON-RPC result in stream");
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** One MCP session, reused for every tool call in a request. */
export async function openSession(token: string): Promise<(name: string, args: Record<string, unknown>) => Promise<unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` };
  const init = await fetch(ERP_MCP, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "rice-stacker", version: "1" } } }) });
  if (init.status === 401) throw new Error("unauthorized");
  if (!init.ok) throw new Error(`initialize: ${init.status} ${(await init.text()).slice(0, 200)}`);
  await readRpc(init);
  const session = init.headers.get("mcp-session-id");
  if (session) headers["Mcp-Session-Id"] = session;
  await fetch(ERP_MCP, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }).catch(() => {});
  let id = 1;
  return async (name, args) => {
    const call = await fetch(ERP_MCP, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) });
    if (!call.ok) throw new Error(`tools/call: ${call.status} ${(await call.text()).slice(0, 200)}`);
    const rpc = await readRpc(call);
    if (rpc.error) throw new Error(`tool error: ${JSON.stringify(rpc.error).slice(0, 200)}`);
    const result = rpc.result as { structuredContent?: unknown; content?: { type: string; text?: string }[]; isError?: boolean };
    if (result.isError) throw new Error(`tool failed: ${(result.content ?? []).map((c) => c.text ?? "").join(" ").slice(0, 200)}`);
    if (result.structuredContent !== undefined) return result.structuredContent;
    const text = (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    try { return JSON.parse(text); } catch { return text; }
  };
}

export const list = <T>(out: unknown): T[] => (Array.isArray(out) ? (out as T[]) : (((out as { items?: T[] } | null)?.items ?? []) as T[]));

export function pkce(): { verifier: string; challenge: Promise<string> } {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then((d) => b64url(new Uint8Array(d)));
  return { verifier, challenge };
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
