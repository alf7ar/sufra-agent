import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CartLine, Quote, addLine, quote } from "./cart.js";
import { normalize, stem, tokens } from "./arabic.js";
import { getItem, resolveIngredient, resolveItem } from "./menu.js";

export interface Order { id: string; placedAt: string; lines: CartLine[]; quote: Quote; status: "placed" }
interface Customer { prefs: Record<string, string>; orders: Order[]; cart: CartLine[] }
interface Data { seq: number; customers: Record<string, Customer> }

const TZ = "Africa/Cairo";
const WEEKDAYS: Record<string, number> = {
  احد: 0, اتنين: 1, اثنين: 1, تلات: 2, ثلاثاء: 2, ثلاثا: 2, اربع: 3, اربعاء: 3, خميس: 4, جمعه: 5, سبت: 6,
};

export function cairoWeekday(d: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: TZ }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}
const cairoDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD

/** Weekday number from a spoken hint ("الجمعة", "Friday"), or undefined. */
export function parseWeekday(hint: string): number | undefined {
  const en = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(hint.trim().toLowerCase());
  if (en >= 0) return en;
  for (const t of tokens(hint)) {
    const w = WEEKDAYS[stem(t)];
    if (w !== undefined) return w;
  }
  return undefined;
}

export interface ReorderResult {
  found: boolean;
  basedOn?: Order;
  cart: CartLine[];
  notes: string[];
}

export class Store {
  private data: Data = { seq: 0, customers: {} };
  constructor(private path?: string) {
    if (path && existsSync(path)) this.data = JSON.parse(readFileSync(path, "utf8"));
  }
  private save() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
  private cust(id: string): Customer {
    return (this.data.customers[id] ??= { prefs: {}, orders: [], cart: [] });
  }

  getCart(id: string): CartLine[] { return this.cust(id).cart; }
  setCart(id: string, cart: CartLine[]) { this.cust(id).cart = cart; this.save(); }

  getPrefs(id: string) { return { ...this.cust(id).prefs }; }
  setPref(id: string, key: string, value: string) { this.cust(id).prefs[key] = value; this.save(); }

  history(id: string, limit = 5): Order[] { return this.cust(id).orders.slice(-limit).reverse(); }
  getOrder(id: string, orderId?: string): Order | undefined {
    const o = this.cust(id).orders;
    return orderId ? o.find((x) => x.id === orderId) : o[o.length - 1];
  }

  /** Insert a historical order (used by the seed). */
  addHistoric(id: string, placedAt: Date, lines: CartLine[]): Order {
    const order: Order = { id: `SF-${String(++this.data.seq).padStart(4, "0")}`, placedAt: placedAt.toISOString(), lines, quote: quote(lines), status: "placed" };
    const orders = this.cust(id).orders;
    orders.push(order);
    orders.sort((a, b) => a.placedAt.localeCompare(b.placedAt));
    this.save();
    return order;
  }

  placeOrder(id: string, now: Date): Order | undefined {
    const c = this.cust(id);
    if (!c.cart.length) return undefined;
    const order = this.addHistoric(id, now, c.cart);
    c.cart = [];
    this.save();
    return order;
  }

  /**
   * "Same as Friday, no onions": find the most recent order on that weekday
   * (or the latest order), copy it into the cart and apply the tweaks.
   */
  reorder(id: string, now: Date, o: { day?: string; without?: string[]; add?: { item: string; qty?: number }[] } = {}): ReorderResult {
    const orders = this.cust(id).orders.filter((x) => new Date(x.placedAt) <= now);
    let pool = orders;
    const notes: string[] = [];
    if (o.day) {
      const hint = normalize(o.day);
      if (/(^| )امبارح( |$)|yesterday/.test(hint)) {
        const y = cairoDate(new Date(now.getTime() - 86_400_000));
        pool = orders.filter((x) => cairoDate(new Date(x.placedAt)) === y);
      } else {
        const wd = parseWeekday(o.day);
        if (wd === undefined) notes.push(`day_not_understood:${o.day}`);
        else pool = orders.filter((x) => cairoWeekday(new Date(x.placedAt)) === wd);
      }
    }
    const basedOn = pool[pool.length - 1];
    if (!basedOn) return { found: false, cart: [], notes: [...notes, "no_matching_order"] };

    let cart: CartLine[] = basedOn.lines.map((l) => ({ ...l, without: [...l.without] }));
    for (const w of o.without ?? []) {
      const ing = resolveIngredient(w);
      if (!ing) { notes.push(`unknown_ingredient:${w}`); continue; }
      let applied = false;
      cart = cart.map((l) => {
        const item = getItem(l.itemId)!;
        if (item.ingredients.some((i) => i.id === ing && i.removable) && !l.without.includes(ing)) { applied = true; return { ...l, without: [...l.without, ing] }; }
        return l;
      });
      if (!applied) notes.push(`ingredient_not_in_order:${ing}`);
    }
    for (const a of o.add ?? []) {
      const item = resolveItem(a.item);
      if (!item) { notes.push(`unknown_item:${a.item}`); continue; }
      try { cart = addLine(cart, item, a.qty ?? 1); } catch (e) { notes.push((e as Error).message); }
    }
    this.setCart(id, cart);
    return { found: true, basedOn, cart, notes };
  }
}

/** Simulated kitchen progress derived from time since the order was placed. */
export function orderStatus(order: Order, now: Date): "placed" | "preparing" | "ready" {
  const mins = (now.getTime() - new Date(order.placedAt).getTime()) / 60_000;
  return mins >= 15 ? "ready" : mins >= 2 ? "preparing" : "placed";
}
