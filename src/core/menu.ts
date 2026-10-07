import { normalize, stem, tokens } from "./arabic.js";

export interface Ingredient { id: string; ar: string; en: string; removable: boolean }
export interface MenuItem {
  id: string;
  nameAr: string;
  nameEn: string;
  /** Egyptian-dialect spellings / synonyms customers actually say. */
  aliases: string[];
  category: "mains" | "sandwiches" | "sides" | "desserts" | "drinks";
  /** Price in piasters (1 EGP = 100), VAT exclusive. */
  price: number;
  tags: string[]; // vegetarian, vegan, spicy, contains-gluten ...
  ingredients: Ingredient[];
  available: boolean;
}

export const RESTAURANT = {
  nameAr: "سفرة الحارة",
  nameEn: "Sufra El-Hara (demo restaurant)",
  currency: "EGP",
  vatRate: 0.14,
} as const;

const onion: Ingredient = { id: "onion", ar: "بصل", en: "onion", removable: true };
const garlic: Ingredient = { id: "garlic", ar: "توم", en: "garlic", removable: true };
const chili: Ingredient = { id: "chili", ar: "شطة", en: "chili", removable: true };
const tahini: Ingredient = { id: "tahini", ar: "طحينة", en: "tahini", removable: true };
const pickles: Ingredient = { id: "pickles", ar: "مخلل", en: "pickles", removable: true };
const tomato: Ingredient = { id: "tomato", ar: "طماطم", en: "tomato", removable: true };

export const MENU: MenuItem[] = [
  { id: "koshary", nameAr: "كشري", nameEn: "Koshary", aliases: ["كشري", "كشرى", "طبق كشري", "كشري وسط"], category: "mains", price: 6000, tags: ["vegan", "contains-gluten"], ingredients: [onion, garlic, chili, tomato], available: true },
  { id: "ful", nameAr: "طبق فول", nameEn: "Ful medames plate", aliases: ["فول", "فول مدمس", "طبق فول"], category: "mains", price: 4000, tags: ["vegan"], ingredients: [onion, chili, tomato, tahini], available: true },
  { id: "taamiya", nameAr: "طعمية (٥ قطع)", nameEn: "Ta'miya (5 pcs)", aliases: ["طعميه", "فلافل", "طعمية", "الفلافل"], category: "sides", price: 3000, tags: ["vegan"], ingredients: [onion, garlic, tahini, pickles], available: true },
  { id: "molokhia", nameAr: "ملوخية بالفراخ", nameEn: "Molokhia with chicken", aliases: ["ملوخيه", "ملوخية", "ملوخيه بالفراخ"], category: "mains", price: 11000, tags: [], ingredients: [garlic, onion], available: true },
  { id: "kofta", nameAr: "كفتة مشوية (نص كيلو)", nameEn: "Grilled kofta (half kilo)", aliases: ["كفته", "كفتة", "كفته مشويه", "نص كيلو كفته"], category: "mains", price: 25000, tags: ["contains-meat"], ingredients: [onion, garlic, pickles], available: true },
  { id: "hawawshi", nameAr: "حواوشي", nameEn: "Hawawshi", aliases: ["حواوشي", "حوواشي", "حواوشى"], category: "sandwiches", price: 9500, tags: ["contains-meat", "contains-gluten"], ingredients: [onion, chili, pickles], available: true },
  { id: "shawarma", nameAr: "ساندوتش شاورما فراخ", nameEn: "Chicken shawarma sandwich", aliases: ["شاورما", "شاورما فراخ", "ساندوتش شاورما"], category: "sandwiches", price: 8500, tags: ["contains-gluten"], ingredients: [garlic, pickles, tahini, chili], available: true },
  { id: "feteer", nameAr: "فطير مشلتت سادة", nameEn: "Plain feteer meshaltet", aliases: ["فطير", "فطيره", "فطير مشلتت", "فطير سادة"], category: "mains", price: 7000, tags: ["vegetarian", "contains-gluten"], ingredients: [], available: true },
  { id: "mahshi", nameAr: "محشي ورق عنب", nameEn: "Stuffed vine leaves", aliases: ["محشي", "ورق عنب", "محشي ورق عنب"], category: "mains", price: 8000, tags: ["vegan"], ingredients: [onion, tomato], available: false },
  { id: "baba", nameAr: "بابا غنوج", nameEn: "Baba ghanoush", aliases: ["بابا غنوج", "بابا", "بابا غنوش"], category: "sides", price: 3500, tags: ["vegan"], ingredients: [garlic, tahini], available: true },
  { id: "salad", nameAr: "سلطة بلدي", nameEn: "Baladi salad", aliases: ["سلطه", "سلطة", "سلطه بلدي"], category: "sides", price: 2500, tags: ["vegan"], ingredients: [onion, tomato, chili], available: true },
  { id: "rice-pudding", nameAr: "رز بلبن", nameEn: "Rice pudding", aliases: ["رز بلبن", "ارز بلبن", "رز باللبن"], category: "desserts", price: 3000, tags: ["vegetarian", "contains-dairy"], ingredients: [], available: true },
  { id: "om-ali", nameAr: "أم علي", nameEn: "Om Ali", aliases: ["ام علي", "أم علي", "ام على"], category: "desserts", price: 4500, tags: ["vegetarian", "contains-dairy", "contains-nuts", "contains-gluten"], ingredients: [], available: true },
  { id: "sugarcane", nameAr: "عصير قصب", nameEn: "Sugarcane juice", aliases: ["عصير قصب", "قصب", "عصير القصب"], category: "drinks", price: 3000, tags: ["vegan"], ingredients: [], available: true },
  { id: "mango", nameAr: "عصير مانجو", nameEn: "Mango juice", aliases: ["مانجو", "عصير مانجا", "عصير مانجو"], category: "drinks", price: 3500, tags: ["vegan"], ingredients: [], available: true },
  { id: "tea", nameAr: "شاي بالنعناع", nameEn: "Mint tea", aliases: ["شاي", "شاي نعناع", "شاي بالنعناع", "كوباية شاي"], category: "drinks", price: 1500, tags: ["vegan"], ingredients: [], available: true },
];

const byId = new Map(MENU.map((m) => [m.id, m]));
export const getItem = (id: string): MenuItem | undefined => byId.get(id);

export interface SearchHit { item: MenuItem; score: number }

function itemKeys(item: MenuItem): string[] {
  return [item.nameAr, item.nameEn, item.id, ...item.aliases].map(normalize);
}

/** Fuzzy search over Arabic/English names and Egyptian aliases. */
export function searchMenu(query: string, opts: { dietary?: string[]; maxPrice?: number; includeUnavailable?: boolean } = {}): SearchHit[] {
  const q = normalize(query);
  const qTokens = tokens(query).map(stem);
  const hits: SearchHit[] = [];
  for (const item of MENU) {
    if (!opts.includeUnavailable && !item.available) continue;
    if (opts.maxPrice !== undefined && item.price > opts.maxPrice) continue;
    if (opts.dietary?.length && !opts.dietary.every((d) => item.tags.includes(d))) continue;
    let score = 0;
    if (!q) score = 1; // empty query lists everything (with filters)
    else {
      const keys = itemKeys(item);
      for (const k of keys) {
        if (k === q) score = Math.max(score, 100);
        else if (q.includes(k) && k.length >= 3) score = Math.max(score, 80 + Math.min(k.length, 10));
        else if (k.includes(q) && q.length >= 3) score = Math.max(score, 60);
        else {
          const kt = k.split(" ").map(stem);
          const overlap = qTokens.filter((t) => t.length >= 2 && kt.includes(t)).length;
          if (overlap) score = Math.max(score, 30 + overlap * 10);
        }
      }
      if (q.length >= 3 && item.category === q) score = Math.max(score, 20);
    }
    if (score > 0) hits.push({ item, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.item.price - b.item.price);
}

/** Best single match for a spoken item name, or undefined. */
export function resolveItem(text: string): MenuItem | undefined {
  const exact = byId.get(text.trim());
  if (exact) return exact;
  const hits = searchMenu(text, { includeUnavailable: true });
  return hits[0] && hits[0].score >= 40 ? hits[0].item : undefined;
}

/** Map a spoken ingredient ("بصل", "البصل", "onions") to an ingredient id. */
export function resolveIngredient(text: string): string | undefined {
  const t = stem(normalize(text));
  const all = [onion, garlic, chili, tahini, pickles, tomato];
  for (const ing of all) {
    const ar = stem(normalize(ing.ar));
    if (t === ar || t === ing.id || t === ing.en || t === ing.en + "s") return ing.id;
  }
  // aliases people say
  const alias: Record<string, string> = { ثوم: "garlic", توم: "garlic", شطه: "chili", حراق: "chili", صلصه: "tomato", طماطم: "tomato", طحينه: "tahini", طحينة: "tahini", مخلل: "pickles", مخللات: "pickles" };
  return alias[t];
}

export function egp(piasters: number): string {
  return (piasters / 100).toFixed(2);
}
