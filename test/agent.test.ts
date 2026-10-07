import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AgentHost } from "../src/agent/host.js";
import { parseIntent, rulesLlm } from "../src/agent/rules.js";
import { SpendGuard } from "../src/agent/llm.js";
import { Store } from "../src/core/memory.js";
import { DEMO_CUSTOMER, seedDemo } from "../src/core/seed.js";

const NOW = new Date("2026-10-10T10:00:00Z");
let server: Server, host: AgentHost, store: Store;

beforeAll(async () => {
  store = new Store(); seedDemo(store, NOW);
  server = createApp({ store, customerId: DEMO_CUSTOMER, now: () => NOW, auth: { token: "t", allowedRedirectHosts: [] } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  host = new AgentHost(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, "t", rulesLlm);
  await host.connect();
});
afterAll(async () => { await host.close(); await new Promise<void>((r) => server.close(() => r())); });

describe("rules intent parser (Egyptian Arabic)", () => {
  it("reorder with weekday and exclusion", () => {
    expect(parseIntent("اطلب لي نفس طلب الجمعة بس من غير بصل")).toEqual([{ name: "reorder_last", args: { day: "الجمعه", without: ["بصل"] } }]);
  });
  it("quantities and modifiers", () => {
    expect(parseIntent("عايز اتنين كشري من غير بصل")).toEqual([{ name: "add_to_cart", args: { item: "koshary", quantity: 2, without: ["بصل"] } }]);
  });
  it("status and confirm", () => {
    expect(parseIntent("فين طلبي")[0].name).toBe("order_status");
    expect(parseIntent("ايوه تمام")[0].name).toBe("place_order");
    expect(parseIntent("لا مش عايز")).toEqual([]);
  });
});

describe("agent host loop through MCP", () => {
  it("same as Friday, no onions -> quote -> confirm -> order is remembered", async () => {
    const t1 = await host.turn("اطلب لي نفس طلب الجمعة بس من غير بصل");
    expect(t1.steps[0].tool).toBe("reorder_last");
    expect(t1.steps[0].result.cart.lines.find((l: any) => l.itemId === "koshary").without).toEqual(["onion"]);
    expect(t1.reply).toContain("من غير بصل");
    const t2 = await host.turn("ايوه تمام");
    expect(t2.steps[0].tool).toBe("place_order");
    expect(t2.steps[0].isError).toBe(false);
    expect(store.history(DEMO_CUSTOMER, 1)[0].lines.some((l) => l.without.includes("onion"))).toBe(true);
  });
  it("unavailable item is refused with an explanation", async () => {
    const t = await host.turn("عايز محشي");
    expect(t.steps[0].isError).toBe(true);
    expect(t.reply).toContain("مش متاح");
  });
});

describe("spend guard", () => {
  it("blocks once the cap is reached", async () => {
    const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const g = new SpendGuard(join(mkdtempSync(join(tmpdir(), "sg-")), "c.jsonl"), 0.01);
    g.assertBudget();
    g.record("chat", 0.02);
    expect(() => g.assertBudget()).toThrow(/spend cap/);
  });
});
