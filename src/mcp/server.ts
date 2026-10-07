import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { addLine, quote, removeLine } from "../core/cart.js";
import { MENU, MenuItem, RESTAURANT, egp, resolveIngredient, resolveItem, searchMenu } from "../core/menu.js";
import { Store, orderStatus } from "../core/memory.js";

export interface Deps { store: Store; customerId: string; now: () => Date }

const card = (i: MenuItem) => ({ id: i.id, nameAr: i.nameAr, nameEn: i.nameEn, price: i.price, priceEgp: egp(i.price), category: i.category, tags: i.tags, removable: i.ingredients.filter((x) => x.removable).map((x) => x.ar) });

function ok(message: string, data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: `${message}\n${JSON.stringify(data)}` }], structuredContent: data };
}
function fail(message: string, code: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }], structuredContent: { error: code, message } };
}
const quoteView = (cart: ReturnType<Store["getCart"]>) => {
  const q = quote(cart);
  return { ...q, subtotalEgp: egp(q.subtotal), vatEgp: egp(q.vat), totalEgp: egp(q.total) };
};
const removedNames = (without: string[]) => without.map((w) => ({ onion: "بصل", garlic: "توم", chili: "شطة", tahini: "طحينة", pickles: "مخلل", tomato: "طماطم" } as Record<string, string>)[w] ?? w);

export function createMcpServer(deps: Deps): McpServer {
  const { store, customerId, now } = deps;
  const server = new McpServer({ name: "sufra-agent", version: "0.1.0" }, {
    instructions: `Ordering agent for ${RESTAURANT.nameEn}. Speak Egyptian Arabic. Prices are EGP, VAT ${RESTAURANT.vatRate * 100}% added at quote. Always quote_total and get the customer's explicit yes before place_order.`,
  });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool("search_menu", {
    title: "Search menu",
    description: "Search the menu by Arabic (Egyptian dialect) or English text. Optional dietary tags (vegan, vegetarian, contains-meat) and max price in EGP. Empty query lists everything available.",
    inputSchema: { query: z.string().default(""), dietary: z.array(z.string()).optional(), max_price_egp: z.number().positive().optional() },
    annotations: readOnly,
  }, async ({ query, dietary, max_price_egp }) => {
    const hits = searchMenu(query, { dietary, maxPrice: max_price_egp ? max_price_egp * 100 : undefined });
    return ok(hits.length ? `لقيت ${hits.length} صنف` : "مفيش صنف بالاسم ده", { items: hits.slice(0, 8).map((h) => card(h.item)), unavailable: MENU.filter((m) => !m.available).map((m) => m.nameAr) });
  });

  server.registerTool("add_to_cart", {
    title: "Add to cart",
    description: "Add an item (id or spoken name) to the cart. `without` lists ingredients to leave out, e.g. [\"بصل\"] for no onions.",
    inputSchema: { item: z.string(), quantity: z.number().int().min(1).max(50).default(1), without: z.array(z.string()).optional() },
  }, async ({ item, quantity, without }) => {
    const found = resolveItem(item);
    if (!found) return fail(`مش لاقي "${item}" في المنيو`, "unknown_item");
    if (!found.available) return fail(`${found.nameAr} مش متاح النهارده`, "item_unavailable");
    const ids: string[] = [];
    const skipped: string[] = [];
    for (const w of without ?? []) {
      const id = resolveIngredient(w);
      if (id && found.ingredients.some((i) => i.id === id && i.removable)) ids.push(id); else skipped.push(w);
    }
    store.setCart(customerId, addLine(store.getCart(customerId), found, quantity, ids));
    const msg = `ضفت ${quantity} ${found.nameAr}${ids.length ? " من غير " + removedNames(ids).join(" و") : ""}` + (skipped.length ? ` (${skipped.join("، ")} مش في الصنف ده)` : "");
    return ok(msg, { added: { ...card(found), quantity, without: ids }, skippedModifiers: skipped, cart: quoteView(store.getCart(customerId)) });
  });

  server.registerTool("remove_from_cart", {
    title: "Remove from cart", description: "Remove an item (all quantities) from the cart.",
    inputSchema: { item: z.string() },
  }, async ({ item }) => {
    const found = resolveItem(item);
    if (!found) return fail(`مش لاقي "${item}"`, "unknown_item");
    store.setCart(customerId, removeLine(store.getCart(customerId), found.id));
    return ok(`شلت ${found.nameAr}`, { cart: quoteView(store.getCart(customerId)) });
  });

  server.registerTool("get_cart", { title: "Get cart", description: "Show the current cart with totals.", inputSchema: {}, annotations: readOnly }, async () => {
    const cart = store.getCart(customerId);
    return ok(cart.length ? "ده الطلب الحالي" : "السلة فاضية", { cart: quoteView(cart) });
  });

  server.registerTool("quote_total", { title: "Quote total", description: "Compute subtotal, VAT (14%) and total for the cart. Call before place_order.", inputSchema: {}, annotations: readOnly }, async () => {
    const cart = store.getCart(customerId);
    if (!cart.length) return fail("السلة فاضية", "empty_cart");
    const q = quoteView(cart);
    return ok(`الإجمالي ${q.totalEgp} جنيه شامل ضريبة القيمة المضافة ١٤٪`, { cart: q });
  });

  server.registerTool("place_order", {
    title: "Place order", description: "Place the cart as an order. Only call after quote_total AND the customer explicitly confirmed; pass confirm=true.",
    inputSchema: { confirm: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ confirm }) => {
    if (!confirm) return fail("لازم تأكيد صريح من العميل قبل ما نبعت الطلب", "confirmation_required");
    const order = store.placeOrder(customerId, now());
    if (!order) return fail("السلة فاضية", "empty_cart");
    return ok(`تم تأكيد الطلب رقم ${order.id}. الإجمالي ${egp(order.quote.total)} جنيه`, { order: { id: order.id, status: order.status, quote: order.quote, totalEgp: egp(order.quote.total) } });
  });

  server.registerTool("order_status", {
    title: "Order status", description: "Status of an order (default: the latest one).", inputSchema: { order_id: z.string().optional() }, annotations: readOnly,
  }, async ({ order_id }) => {
    const o = store.getOrder(customerId, order_id);
    if (!o) return fail("مفيش طلب بالرقم ده", "order_not_found");
    const status = orderStatus(o, now());
    const ar = { placed: "اتسجل", preparing: "بيتحضّر", ready: "جاهز" }[status];
    return ok(`الطلب ${o.id} ${ar}`, { orderId: o.id, status, placedAt: o.placedAt });
  });

  server.registerTool("order_history", {
    title: "Order history", description: "The customer's past orders (most recent first).", inputSchema: { limit: z.number().int().min(1).max(10).default(5) }, annotations: readOnly,
  }, async ({ limit }) => {
    const orders = store.history(customerId, limit).map((o) => ({ id: o.id, placedAt: o.placedAt, totalEgp: egp(o.quote.total), lines: o.quote.lines.map((l) => ({ nameAr: l.nameAr, qty: l.qty, without: removedNames(l.without) })) }));
    return ok(`آخر ${orders.length} طلبات`, { orders });
  });

  server.registerTool("reorder_last", {
    title: "Reorder a past order",
    description: "Copy a past order into the cart, optionally by weekday ('الجمعة', 'Friday', 'امبارح') and with tweaks: `without` = ingredients to drop (e.g. [\"بصل\"]), `add` = extra items. Result is a cart; still quote and confirm before place_order.",
    inputSchema: { day: z.string().optional(), without: z.array(z.string()).optional(), add: z.array(z.object({ item: z.string(), qty: z.number().int().min(1).max(20).optional() })).optional() },
  }, async ({ day, without, add }) => {
    const r = store.reorder(customerId, now(), { day, without, add });
    if (!r.found) return fail(day ? `مفيش طلب قديم يوم ${day}` : "لسه معندكش طلبات قديمة", "no_matching_order");
    const q = quoteView(r.cart);
    return ok(`رجّعت طلب ${r.basedOn!.id}${without?.length ? " من غير " + without.join(" و") : ""}. الإجمالي ${q.totalEgp} جنيه`, { basedOn: r.basedOn!.id, basedOnDate: r.basedOn!.placedAt, notes: r.notes, cart: q });
  });

  server.registerTool("get_preferences", { title: "Get preferences", description: "Saved customer preferences (e.g. spice level, address label).", inputSchema: {}, annotations: readOnly }, async () => ok("تفضيلاتك", { preferences: store.getPrefs(customerId) }));

  server.registerTool("set_preference", {
    title: "Set preference", description: "Remember a preference across sessions (key like 'spice', 'allergy', value free text).",
    inputSchema: { key: z.string().min(1).max(40), value: z.string().min(1).max(120) },
  }, async ({ key, value }) => {
    store.setPref(customerId, key, value);
    return ok(`حفظت ${key}: ${value}`, { preferences: store.getPrefs(customerId) });
  });

  return server;
}
