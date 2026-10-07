import { MenuItem, RESTAURANT, getItem } from "./menu.js";

export interface CartLine { itemId: string; qty: number; /** ingredient ids the customer does not want */ without: string[] }
export interface QuoteLine { itemId: string; nameAr: string; nameEn: string; qty: number; without: string[]; unitPrice: number; lineTotal: number }
export interface Quote { lines: QuoteLine[]; subtotal: number; vat: number; total: number; currency: string; vatRate: number }

const sameMods = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Pure: returns a new cart with the line merged in. */
export function addLine(cart: CartLine[], item: MenuItem, qty: number, without: string[] = []): CartLine[] {
  if (!item.available) throw new Error(`item_unavailable:${item.id}`);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new Error("invalid_quantity");
  const mods = [...new Set(without)].filter((w) => item.ingredients.some((i) => i.id === w && i.removable));
  const next = cart.map((l) => ({ ...l, without: [...l.without] }));
  const existing = next.find((l) => l.itemId === item.id && sameMods(l.without, mods));
  if (existing) existing.qty += qty;
  else next.push({ itemId: item.id, qty, without: mods });
  return next;
}

export function removeLine(cart: CartLine[], itemId: string): CartLine[] {
  return cart.filter((l) => l.itemId !== itemId);
}

export function quote(cart: CartLine[]): Quote {
  const lines: QuoteLine[] = cart.map((l) => {
    const item = getItem(l.itemId);
    if (!item) throw new Error(`unknown_item:${l.itemId}`);
    return { itemId: item.id, nameAr: item.nameAr, nameEn: item.nameEn, qty: l.qty, without: l.without, unitPrice: item.price, lineTotal: item.price * l.qty };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const vat = Math.round(subtotal * RESTAURANT.vatRate);
  return { lines, subtotal, vat, total: subtotal + vat, currency: RESTAURANT.currency, vatRate: RESTAURANT.vatRate };
}
