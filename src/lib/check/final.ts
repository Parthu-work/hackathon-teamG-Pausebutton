import type { Verdict } from "./types";

export type FamilyVerdict = "scam" | "not_scam" | null;

/**
 * What the person finally sees. Once a trusted person has answered, their
 * answer decides: "not a scam" shows as SAFE, "it's a scam" as SCAM. The
 * automatic verdict stays on record and is still explained on the screen.
 */
export function finalVerdict(verdict: Verdict, family: FamilyVerdict): Verdict {
  if (family === "not_scam") return "SAFE";
  if (family === "scam") return "SCAM";
  return verdict;
}
