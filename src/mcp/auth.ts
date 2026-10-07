import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Minimal OAuth 2.1 authorization-code + PKCE (S256) provider for the DEMO.
 * It auto-approves a single fictional customer and hands back a static bearer token.
 * Production would put a real identity provider here (see README "Auth").
 */
export interface AuthConfig { token: string; allowedRedirectHosts: string[] }

interface Pending { challenge: string; redirectUri: string; expires: number }
const codes = new Map<string, Pending>();

export const originOf = (req: IncomingMessage): string => {
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  return `${proto}://${req.headers.host}`;
};

export function checkBearer(req: IncomingMessage, token: string): boolean {
  const h = req.headers.authorization ?? "";
  const m = /^Bearer (.+)$/.exec(h);
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export function protectedResourceMetadata(req: IncomingMessage, res: ServerResponse) {
  const o = originOf(req);
  json(res, 200, { resource: `${o}/mcp`, authorization_servers: [o], scopes_supported: ["orders"], bearer_methods_supported: ["header"] });
}

export function authServerMetadata(req: IncomingMessage, res: ServerResponse) {
  const o = originOf(req);
  json(res, 200, {
    issuer: o, authorization_endpoint: `${o}/authorize`, token_endpoint: `${o}/token`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["orders"],
  });
}

function redirectAllowed(uri: string, cfg: AuthConfig): boolean {
  try {
    const u = new URL(uri);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    return u.protocol === "https:" && cfg.allowedRedirectHosts.includes(u.hostname);
  } catch { return false; }
}

export function authorize(url: URL, res: ServerResponse, cfg: AuthConfig) {
  const q = url.searchParams;
  const redirectUri = q.get("redirect_uri") ?? "";
  if (!redirectAllowed(redirectUri, cfg)) return json(res, 400, { error: "invalid_redirect_uri" });
  const redirect = (params: Record<string, string>) => {
    const r = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) r.searchParams.set(k, v);
    if (q.get("state")) r.searchParams.set("state", q.get("state")!);
    res.writeHead(302, { location: r.toString() });
    res.end();
  };
  if (q.get("response_type") !== "code") return redirect({ error: "unsupported_response_type" });
  if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return redirect({ error: "invalid_request", error_description: "PKCE S256 required" });
  const code = randomBytes(24).toString("base64url");
  codes.set(code, { challenge: q.get("code_challenge")!, redirectUri, expires: Date.now() + 5 * 60_000 });
  redirect({ code });
}

export function token(body: URLSearchParams, res: ServerResponse, cfg: AuthConfig) {
  const err = (e: string) => json(res, 400, { error: e });
  if (body.get("grant_type") !== "authorization_code") return err("unsupported_grant_type");
  const code = body.get("code") ?? "";
  const p = codes.get(code);
  codes.delete(code); // one-time use
  if (!p || p.expires < Date.now()) return err("invalid_grant");
  if (body.get("redirect_uri") !== p.redirectUri) return err("invalid_grant");
  const verifier = body.get("code_verifier") ?? "";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  if (challenge !== p.challenge) return err("invalid_grant");
  json(res, 200, { access_token: cfg.token, token_type: "Bearer", expires_in: 3600, scope: "orders" });
}
