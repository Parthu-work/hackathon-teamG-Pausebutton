import type { Language } from "@/lib/views";
import { en } from "./en";
import { hi } from "./hi";
import { te } from "./te";

// F5 · Hindi and Telugu, for real. One dictionary per language with the same
// shape as English. t("home.doorCall") looks a key up by path; {name}
// placeholders are filled from the second argument. A missing translation
// falls back to English, so a half-translated language never shows a key.

/** Deep "same keys, string leaves" shape of the English dictionary. */
type Shape<T> = { [K in keyof T]: T[K] extends readonly string[] ? readonly string[] : T[K] extends string ? string : Shape<T[K]> };
export type Dict = Shape<typeof en>;

export const LANGUAGES: { code: Language; name: string; native: string; bcp47: string }[] = [
  { code: "en", name: "English", native: "English", bcp47: "en-IN" },
  { code: "hi", name: "Hindi", native: "हिन्दी", bcp47: "hi-IN" },
  { code: "te", name: "Telugu", native: "తెలుగు", bcp47: "te-IN" },
];

const dicts: Record<Language, Dict> = { en, hi, te };

export function dict(lang: Language | string | undefined): Dict {
  return dicts[(lang ?? "en") as Language] ?? en;
}

/** Fills {name}-style placeholders. */
export function fill(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends readonly string[] ? never : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every dotted path that ends in a string, e.g. "home.doorCall". */
export type Key = Leaves<typeof en>;

function lookup(d: Dict, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), d);
}

export type T = (key: Key, vars?: Record<string, string | number>) => string;

/** A translator for one language. */
export function translator(lang: Language | string | undefined): T {
  const d = dict(lang);
  return (key, vars) => {
    const v = lookup(d, key) ?? lookup(en, key);
    return fill(typeof v === "string" ? v : key, vars);
  };
}

/** "Arjun and Meera", in the language's own joining word. */
export function joinNamesIn(t: T, names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return names.slice(0, -1).join(", ") + ` ${t("common.and")} ` + names[names.length - 1];
}

export function bcp47(lang: Language | string | undefined) {
  return LANGUAGES.find((l) => l.code === lang)?.bcp47 ?? "en-IN";
}
