import { Store } from "./memory.js";
import { cairoWeekday } from "./memory.js";

export const DEMO_CUSTOMER = "demo-customer";

/** Fictional order history relative to `now`: last Friday (koshary x2 + taamiya + tea), last Tuesday, etc. */
export function seedDemo(store: Store, now: Date = new Date()): void {
  const daysAgoFor = (weekday: number) => {
    for (let d = 1; d <= 7; d++) {
      const t = new Date(now.getTime() - d * 86_400_000);
      if (cairoWeekday(t) === weekday) return t;
    }
    return now;
  };
  const at = (base: Date, hourUtc: number) => { const t = new Date(base); t.setUTCHours(hourUtc, 15, 0, 0); return t; };
  store.addHistoric(DEMO_CUSTOMER, at(daysAgoFor(2), 16), [
    { itemId: "shawarma", qty: 2, without: [] },
    { itemId: "mango", qty: 1, without: [] },
  ]);
  store.addHistoric(DEMO_CUSTOMER, at(daysAgoFor(5), 17), [
    { itemId: "koshary", qty: 2, without: [] },
    { itemId: "taamiya", qty: 1, without: [] },
    { itemId: "tea", qty: 2, without: [] },
  ]);
  store.setPref(DEMO_CUSTOMER, "spice", "mild");
}
