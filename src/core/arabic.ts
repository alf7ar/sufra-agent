// Arabic text normalisation used for fuzzy menu matching.
const TASHKEEL = /[ً-ٰٟـ]/g; // diacritics + tatweel
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

/** Strip a leading definite article / conjunction so "البصل" matches "بصل". */
export function stem(w: string): string {
  return w.replace(/^(وال|بال|كال|فال|ال|و)(?=.{2,})/, "");
}
