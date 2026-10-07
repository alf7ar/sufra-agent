import { describe, expect, it } from "vitest";
import { normalize } from "../src/core/arabic.js";
import { addLine, quote } from "../src/core/cart.js";
import { getItem, resolveIngredient, resolveItem, searchMenu } from "../src/core/menu.js";
import { Store, cairoWeekday, orderStatus, parseWeekday } from "../src/core/memory.js";
import { DEMO_CUSTOMER, seedDemo } from "../src/core/seed.js";

// A Saturday 2026-10-10 12:00 Cairo; "last Friday" = 2026-10-09 is the day before.
const NOW = new Date("2026-10-10T10:00:00Z");

describe("arabic normalisation + menu search", () => {
  it("normalises hamza, ta marbuta, ya, tashkeel and Arabic digits", () => {
    expect(normalize("كُشَرِي")).toBe("كشري");
    expect(normalize("أم علي ٣")).toBe("ام علي 3");
    expect(normalize("ملوخية")).toBe(normalize("ملوخيه"));
  });
  it("finds items by Egyptian dialect alias", () => {
    expect(searchMenu("فلافل")[0].item.id).toBe("taamiya");
    expect(searchMenu("عايز كشري")[0].item.id).toBe("koshary");
    expect(resolveItem("شاورما")?.id).toBe("shawarma");
    expect(resolveItem("ازاي اروح المطار")).toBeUndefined();
  });
  it("filters by dietary tag, price and availability", () => {
    expect(searchMenu("", { dietary: ["vegetarian"] }).map((h) => h.item.id)).toEqual(expect.arrayContaining(["feteer", "om-ali"]));
    expect(searchMenu("", { maxPrice: 3000 }).every((h) => h.item.price <= 3000)).toBe(true);
    expect(searchMenu("محشي").length).toBe(0); // mahshi is 86'd
    expect(searchMenu("محشي", { includeUnavailable: true })[0].item.id).toBe("mahshi");
  });
  it("resolves spoken ingredients", () => {
    expect(resolveIngredient("بصل")).toBe("onion");
    expect(resolveIngredient("البصل")).toBe("onion");
    expect(resolveIngredient("onions")).toBe("onion");
    expect(resolveIngredient("ثوم")).toBe("garlic");
  });
});

describe("cart + quote", () => {
  it("merges identical lines and keeps modifiers separate", () => {
    let c = addLine([], getItem("koshary")!, 1);
    c = addLine(c, getItem("koshary")!, 1);
    c = addLine(c, getItem("koshary")!, 1, ["onion"]);
    expect(c).toEqual([{ itemId: "koshary", qty: 2, without: [] }, { itemId: "koshary", qty: 1, without: ["onion"] }]);
  });
  it("ignores modifiers the item does not have and rejects 86'd items", () => {
    expect(addLine([], getItem("feteer")!, 1, ["onion"])[0].without).toEqual([]);
    expect(() => addLine([], getItem("mahshi")!, 1)).toThrow("item_unavailable");
  });
  it("adds 14% VAT in integer piasters", () => {
    const q = quote([{ itemId: "koshary", qty: 2, without: [] }, { itemId: "tea", qty: 1, without: [] }]);
    expect(q.subtotal).toBe(13500);
    expect(q.vat).toBe(1890);
    expect(q.total).toBe(15390);
  });
});

describe("memory: 'same as Friday, no onions'", () => {
  const mk = () => { const s = new Store(); seedDemo(s, NOW); return s; };
  it("parses weekday words", () => {
    expect(parseWeekday("الجمعة")).toBe(5);
    expect(parseWeekday("يوم الخميس")).toBe(4);
    expect(parseWeekday("Friday")).toBe(5);
    expect(parseWeekday("بكره")).toBeUndefined();
    expect(cairoWeekday(new Date("2026-10-09T10:00:00Z"))).toBe(5);
  });
  it("copies last Friday's order and drops onions only where onions exist", () => {
    const s = mk();
    const r = s.reorder(DEMO_CUSTOMER, NOW, { day: "الجمعة", without: ["بصل"] });
    expect(r.found).toBe(true);
    const byId = Object.fromEntries(r.cart.map((l) => [l.itemId, l]));
    expect(byId.koshary.qty).toBe(2);
    expect(byId.koshary.without).toEqual(["onion"]);
    expect(byId.taamiya.without).toEqual(["onion"]);
    expect(byId.tea.without).toEqual([]); // tea has no onions
    expect(s.getCart(DEMO_CUSTOMER)).toEqual(r.cart); // persisted in the cart
  });
  it("supports extra items and reports unknown ones", () => {
    const r = mk().reorder(DEMO_CUSTOMER, NOW, { day: "الجمعة", add: [{ item: "عصير مانجو", qty: 2 }, { item: "بيتزا فضائية" }] });
    expect(r.cart.find((l) => l.itemId === "mango")?.qty).toBe(2);
    expect(r.notes).toContain("unknown_item:بيتزا فضائية");
  });
  it("no match -> found:false; no day -> latest order; yesterday works", () => {
    const s = mk();
    expect(s.reorder(DEMO_CUSTOMER, NOW, { day: "السبت" }).found).toBe(false);
    expect(s.reorder(DEMO_CUSTOMER, NOW, {}).basedOn?.lines.some((l) => l.itemId === "koshary")).toBe(true);
    expect(s.reorder(DEMO_CUSTOMER, NOW, { day: "امبارح" }).basedOn?.lines.some((l) => l.itemId === "koshary")).toBe(true);
  });
  it("places an order, clears the cart and remembers it", () => {
    const s = mk();
    s.reorder(DEMO_CUSTOMER, NOW, { day: "الجمعة" });
    const o = s.placeOrder(DEMO_CUSTOMER, NOW)!;
    expect(s.getCart(DEMO_CUSTOMER)).toEqual([]);
    expect(s.history(DEMO_CUSTOMER, 1)[0].id).toBe(o.id);
    expect(orderStatus(o, NOW)).toBe("placed");
    expect(orderStatus(o, new Date(NOW.getTime() + 20 * 60_000))).toBe("ready");
  });
  it("persists to disk across Store instances", async () => {
    const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const p = join(mkdtempSync(join(tmpdir(), "sufra-")), "m.json");
    const a = new Store(p); a.setPref("c1", "spice", "hot");
    expect(new Store(p).getPrefs("c1")).toEqual({ spice: "hot" });
  });
});
