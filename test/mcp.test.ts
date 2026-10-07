import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/app.js";
import { Store } from "../src/core/memory.js";
import { DEMO_CUSTOMER, seedDemo } from "../src/core/seed.js";

const NOW = new Date("2026-10-10T10:00:00Z");
const TOKEN = "test-token";
let server: Server, base: string;

beforeAll(async () => {
  const store = new Store();
  seedDemo(store, NOW);
  server = createApp({ store, customerId: DEMO_CUSTOMER, now: () => NOW, auth: { token: TOKEN, allowedRedirectHosts: ["pitangui.amazon.com"] } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function connect(token = TOKEN) {
  const client = new Client({ name: "test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  return { client, transport };
}
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await c.callTool({ name, arguments: args });
  return { ...r, data: r.structuredContent as any };
};

describe("MCP over Streamable HTTP", () => {
  it("negotiates protocol 2025-11-25 and lists the tools", async () => {
    const { client, transport } = await connect();
    expect(transport.protocolVersion).toBe("2025-11-25");
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["add_to_cart", "get_cart", "get_preferences", "order_history", "order_status", "place_order", "quote_total", "remove_from_cart", "reorder_last", "search_menu", "set_preference"]);
    await client.close();
  });

  it("raw initialize returns the 2025-11-25 protocolVersion", async () => {
    const r = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
    });
    expect((await r.json()).result.protocolVersion).toBe("2025-11-25");
  });

  it("full flow: reorder Friday without onions -> quote -> confirm -> status", async () => {
    const { client } = await connect();
    const re = await call(client, "reorder_last", { day: "الجمعة", without: ["بصل"] });
    expect(re.isError).toBeFalsy();
    const kosh = re.data.cart.lines.find((l: any) => l.itemId === "koshary");
    expect(kosh.without).toEqual(["onion"]);
    expect(re.data.cart.total).toBe(Math.round(re.data.cart.subtotal * 1.14));
    expect((await call(client, "place_order", { confirm: false })).isError).toBe(true);
    const placed = await call(client, "place_order", { confirm: true });
    expect(placed.data.order.id).toMatch(/^SF-/);
    expect((await call(client, "order_status", {})).data.orderId).toBe(placed.data.order.id);
    expect((await call(client, "get_cart")).data.cart.lines).toEqual([]);
    // memory across sessions: a brand-new client sees the order in history
    const { client: c2 } = await connect();
    expect((await call(c2, "order_history", { limit: 1 })).data.orders[0].id).toBe(placed.data.order.id);
    await client.close(); await c2.close();
  });

  it("search + add_to_cart with a modifier in Egyptian Arabic; 86'd item rejected", async () => {
    const { client } = await connect();
    expect((await call(client, "search_menu", { query: "فلافل" })).data.items[0].id).toBe("taamiya");
    const add = await call(client, "add_to_cart", { item: "حواوشي", quantity: 2, without: ["البصل", "طحينة"] });
    expect(add.data.added.without).toEqual(["onion"]);
    expect(add.data.skippedModifiers).toEqual(["طحينة"]);
    const bad = await call(client, "add_to_cart", { item: "محشي" });
    expect(bad.isError).toBe(true);
    expect(bad.data.error).toBe("item_unavailable");
    await client.close();
  });
});

describe("auth", () => {
  it("401 without or with a wrong bearer token", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const h = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    const a = await fetch(`${base}/mcp`, { method: "POST", headers: h, body });
    expect(a.status).toBe(401);
    expect(a.headers.get("www-authenticate")).toBeNull(); // per Alexa+ docs
    const b = await fetch(`${base}/mcp`, { method: "POST", headers: { ...h, authorization: "Bearer nope" }, body });
    expect(b.status).toBe(401);
  });
  it("serves discovery metadata with S256", async () => {
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
    expect(prm.resource).toBe(`${base}/mcp`);
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(as.code_challenge_methods_supported).toContain("S256");
  });
  it("authorization-code + PKCE flow yields a working token; bad verifier / redirect rejected", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirect = "https://pitangui.amazon.com/api/skill/link/X";
    const u = new URL(`${base}/authorize`);
    Object.entries({ response_type: "code", client_id: "alexa", redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s1" }).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u, { redirect: "manual" });
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.searchParams.get("state")).toBe("s1");
    const code = loc.searchParams.get("code")!;
    const tok = (v: string, c = code) => fetch(`${base}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: c, code_verifier: v, redirect_uri: redirect }) });
    expect((await tok("wrong-verifier")).status).toBe(400); // consumes the code
    expect((await tok(verifier)).status).toBe(400); // code is one-time
    // fresh code, right verifier
    const r2 = await fetch(u, { redirect: "manual" });
    const code2 = new URL(r2.headers.get("location")!).searchParams.get("code")!;
    const ok = await (await tok(verifier, code2)).json();
    expect(ok.token_type).toBe("Bearer");
    const { client } = await connect(ok.access_token);
    expect((await client.listTools()).tools.length).toBeGreaterThan(5);
    await client.close();
    // redirect host not allow-listed
    u.searchParams.set("redirect_uri", "https://evil.example/cb");
    expect((await fetch(u, { redirect: "manual" })).status).toBe(400);
  });
});
