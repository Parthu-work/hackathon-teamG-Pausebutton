import { dict, fill, type Dict } from "@/lib/i18n";
import type { Language } from "@/lib/views";
import type { CheckResult, ScamFamily, SignalType, Verdict } from "./types";

// All wording people see comes from the dictionaries in src/lib/i18n (not
// from the AI), so it stays plain, calm and translatable (F5). {helper} is
// replaced with the first trusted person's name, e.g. "Arjun". Family
// members' screens read English; Mr Rao's read his chosen language.

type Lang = Language | string | undefined;

export const SIGNAL_LABEL: Record<SignalType, string> = {
  authority: "Authority",
  fear: "Fear",
  secrecy: "Secrecy",
  payment: "Payment",
};

export const SIGNAL_WHY: Record<SignalType, string> = {
  authority: "Police and agencies do not contact you like this.",
  fear: "A scary claim is used to make you panic.",
  secrecy: "Real officials never ask you to hide it from family.",
  payment: "No agency asks for money to “verify” you.",
};

export const signalLabel = (type: SignalType, lang?: Lang) => dict(lang).signal[type];
export const signalWhy = (type: SignalType, lang?: Lang) => dict(lang).signalWhy[type];
export const verdictLabel = (verdict: Verdict, lang?: Lang) => dict(lang).verdictLabel[verdict];

export type FamilyCopy = Dict["families"][ScamFamily];

export function familyCopy(family: ScamFamily | null, lang?: Lang): FamilyCopy {
  return dict(lang).families[family ?? "pressure"];
}

export function verdictCopy(result: Pick<CheckResult, "verdict" | "family">, helper: string, normalizedHint = "", lang?: Lang) {
  const d = dict(lang);
  if (result.verdict === "SAFE") {
    const bank = /debited|credited|a\/c|avl bal|account ending/i.test(normalizedHint);
    return { headline: bank ? d.safe.bankHeadline : d.safe.headline, body: bank ? d.safe.bankBody : d.safe.body };
  }
  const fc = familyCopy(result.family, lang);
  const [headline, body] = result.verdict === "SCAM" ? fc.scam : fc.suspicious;
  return { headline: fill(headline, { helper }), body: fill(body, { helper }) };
}

export const VERDICT_PILL: Record<Verdict, { label: string; tone: "red" | "amber" | "green" }> = {
  SCAM: { label: "SCAM", tone: "red" },
  SUSPICIOUS: { label: "SUSPICIOUS", tone: "amber" },
  SAFE: { label: "SAFE", tone: "green" },
};

export const DO_LIST = (helpers: string, lang?: Lang) => dict(lang).doList.map((s) => fill(s, { helpers }));

export const DONT_LIST = (lang?: Lang) => [...dict(lang).dontList];

/** Advice the family member can send with one tap (I2). */
export const ADVICE_PRESETS = [
  "Hang up. Do not pay or click anything.",
  "Stay on the phone with me. I am calling now.",
  "Show this message to the bank or the police.",
];

/** "What to say" line for the family member's alert screens. */
export function whatToSay(verdict: Verdict, relation: string) {
  const name = relation || "Papa";
  return verdict === "SCAM"
    ? `“${name}, hang up. Do not send money. I am calling you now.”`
    : `“${name}, do not reply and do not pay. I am calling you.”`;
}

export function rupees(value: number) {
  return "Rs " + value.toLocaleString("en-IN");
}

/** "Rs 1.2 lakh" for the ledger's big numbers (F12). */
export function rupeesShort(value: number) {
  if (value >= 10_000_000) return `Rs ${(value / 10_000_000).toFixed(value % 10_000_000 ? 1 : 0)} crore`;
  if (value >= 100_000) return `Rs ${(value / 100_000).toFixed(value % 100_000 ? 1 : 0)} lakh`;
  return rupees(value);
}
