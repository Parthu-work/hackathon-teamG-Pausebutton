import type { Evidence, LinkInfo, SignalType } from "./types";

const ORDER: SignalType[] = ["secrecy", "payment", "authority", "fear"];

/** The few warning phrases family members are shown, most telling first. */
export function keyPhrases(
  signals: Evidence[],
  link: LinkInfo | null,
  hardPhrases: { phrase: string }[] = [],
  max = 3,
): string[] {
  const out: string[] = hardPhrases.map((h) => h.phrase);
  for (const type of ORDER) {
    for (const s of signals.filter((x) => x.type === type)) {
      if (!out.some((p) => p.toLowerCase() === s.phrase.toLowerCase())) out.push(s.phrase);
    }
  }
  if (link && link.status !== "known") out.splice(Math.min(out.length, 2), 0, link.domain);
  return out.slice(0, max);
}
