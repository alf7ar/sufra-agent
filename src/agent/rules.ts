import { normalize, tokens } from "../core/arabic.js";
import { MENU, resolveIngredient, searchMenu } from "../core/menu.js";
import { parseWeekday } from "../core/memory.js";
import type { Llm, LlmReply, Msg } from "./llm.js";

/**
 * Deterministic Egyptian-Arabic intent parser used when no LLM key is configured
 * (and by the tests). It emits the same tool calls an LLM would.
 */
const NUM: Record<string, number> = { واحد: 1, واحده: 1, اتنين: 2, اثنين: 2, تلاته: 3, ثلاثه: 3, اربعه: 4, خمسه: 5, عشره: 10 };

function qtyBefore(ws: string[], i: number): number {
  for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
    const w = ws[k];
    if (/^\d+$/.test(w)) return Number(w);
    if (NUM[w]) return NUM[w];
  }
  return 1;
}

export function parseIntent(text: string): { name: string; args: Record<string, unknown> }[] {
  const t = normalize(text);
  const ws = tokens(text);
  const has = (...p: string[]) => p.some((x) => t.includes(normalize(x)));
  const withoutWords: string[] = [];
  ws.forEach((w, i) => {
    if (w === "من" && ws[i + 1] === "غير") for (const x of ws.slice(i + 2, i + 5)) { if (resolveIngredient(x)) withoutWords.push(x); else break; }
    if (w === "بدون" || w === "من_غير") for (const x of ws.slice(i + 1, i + 4)) { if (resolveIngredient(x)) withoutWords.push(x); else break; }
  });

  if (has("نفس", "زي", "كرر", "زى") && (parseWeekday(text) !== undefined || has("امبارح", "المره اللي فاتت", "اخر مره", "اخر طلب"))) {
    const day = has("امبارح") ? "امبارح" : ws.find((w) => parseWeekday(w) !== undefined);
    return [{ name: "reorder_last", args: { ...(day ? { day } : {}), ...(withoutWords.length ? { without: withoutWords } : {}) } }];
  }
  if (has("فين الطلب", "فين طلبي", "حاله الطلب", "الطلب وصل", "وصل الطلب")) return [{ name: "order_status", args: {} }];
  if (has("اه", "ايوه", "ايوا", "تمام", "اكد", "أكد", "موافق", "ابعت", "yes") && ws.length <= 6 && !has("مش", "لا")) return [{ name: "place_order", args: { confirm: true } }];
  if (has("المنيو", "عندكم ايه", "فيه ايه", "اكل ايه")) return [{ name: "search_menu", args: { query: "" } }];
  if (has("نباتي", "صيامي")) return [{ name: "search_menu", args: { query: "", dietary: ["vegan"] } }];
  if (has("الحساب", "الاجمالي", "كام", "السعر", "اجمالي")) return [{ name: "quote_total", args: {} }];
  if (has("شيل", "الغي", "امسح")) {
    const hit = searchMenu(text)[0];
    if (hit) return [{ name: "remove_from_cart", args: { item: hit.item.id } }];
  }
  // add items: find every menu alias mentioned
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const used = new Set<string>();
  const padded = " " + t + " ";
  for (const item of MENU) {
    for (const key of [item.nameAr, ...item.aliases].map(normalize).sort((a, b) => b.length - a.length)) {
      const idx = padded.indexOf(" " + key + " ");
      const loose = idx < 0 ? padded.indexOf(key) : idx;
      if (loose >= 0 && key.length >= 3 && !used.has(item.id)) {
        used.add(item.id);
        const before = padded.slice(0, loose).trim().split(" ").filter(Boolean);
        calls.push({ name: "add_to_cart", args: { item: item.id, quantity: qtyBefore(before, before.length), ...(withoutWords.length ? { without: withoutWords } : {}) } });
        break;
      }
    }
  }
  return calls;
}

let n = 0;
export const rulesLlm: Llm = async (messages: Msg[]): Promise<LlmReply> => {
  const last = messages[messages.length - 1];
  if (last.role === "user") {
    const calls = parseIntent(last.content);
    if (!calls.length) return { content: "ممكن تقولي عايز تطلب إيه؟ أو قول «المنيو» وأنا أعرضلك الأصناف.", tool_calls: [] };
    return { content: null, tool_calls: calls.map((c) => ({ id: `r${++n}`, ...c })) };
  }
  // tool results: speak the first line (Arabic message) of each result
  const results: string[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i].role === "tool"; i--) results.unshift((messages[i] as { content: string }).content.split("\n")[0]);
  let reply = results.join("، ");
  const lastCall = [...messages].reverse().find((m) => m.role === "assistant" && (m as any).tool_calls) as any;
  const names: string[] = lastCall?.tool_calls.map((c: any) => c.name) ?? [];
  if (names.includes("reorder_last") || names.includes("add_to_cart")) reply += ". أأكد الطلب؟";
  if (names.includes("search_menu")) reply = "دي الأصناف المتاحة النهارده. تحب تطلب إيه؟";
  return { content: reply, tool_calls: [] };
};
