import { readWithClaude } from "./ai";
import { LINK_POINTS, SCAM_AT, SIGNAL_POINTS, SUSPICIOUS_AT, type AiModelKey } from "./config";
import { scoreGate } from "./gate";
import { findLinks, worstLink } from "./links";
import { detectFamily, findAmount, findPayee, runRules } from "./rules";
import type { CheckResult, Evidence, HardRule, LinkInfo, SignalType, Verdict } from "./types";

export const MAX_MESSAGE_CHARS = 4000;

export type CheckOptions = {
  /** "off" = rules and model only (used for the rules-only test run). */
  ai?: "auto" | "off";
  aiModel?: AiModelKey;
  aiTimeoutMs?: number;
  /** Domains families reported and a reviewer blocked (F9); they count like the file blocklist. */
  blockedDomains?: string[];
};

/**
 * Step 1: hard rules. Any match is a SCAM straight away.
 * Step 2: soft rules. Signal points and the fast-gate model give a spam
 *         percentage: 70%+ with at least one phrase is SCAM, 30–69% is
 *         SUSPICIOUS (the person asks family), below 30% is SAFE.
 * Step 3: only for SUSPICIOUS, Claude reads the message. It can add signals
 *         and raise the verdict, never lower it.
 */
export async function checkMessage(input: string, opts: CheckOptions = {}): Promise<CheckResult> {
  const text = input.slice(0, MAX_MESSAGE_CHARS);
  const rules = runRules(text);
  const link = worstLink(findLinks(text, opts.blockedDomains));
  const gate = scoreGate(text);
  const modelScore = gate ? Math.round(gate.probability * 100) : null;

  let signals = rules.signals;
  let hardRule = hardRuleFor(signals, rules.credential.length > 0, link);
  let rulesScore = points(signals, link);
  let score = Math.max(rulesScore, modelScore ?? 0);
  let verdict: Verdict = hardRule ? "SCAM" : tier(score, rulesScore);
  let decidedBy: CheckResult["decidedBy"] = hardRule ? "hard_rule" : "score";
  let ai: CheckResult["ai"] = { status: "not_needed" };
  let degraded = false;
  // F8: nothing we know matched (no phrase, no link, no code request) and
  // only the model's hunch brought it here. If Claude then convicts it with
  // quoted words, that is a new trick, and we say so.
  const nothingMatched = signals.length === 0 && !link && rules.credential.length === 0;

  if (verdict === "SUSPICIOUS") {
    if (opts.ai === "off") {
      ai = { status: "unavailable" };
    } else {
      const reading = await readWithClaude(text, opts.aiModel, opts.aiTimeoutMs);
      ai = { status: reading.status, model: reading.model, family: reading.scamType };
      if (reading.status === "ok") {
        signals = mergeEvidence(signals, reading.signals);
        rulesScore = points(signals, link);
        score = Math.max(rulesScore, modelScore ?? 0);
        hardRule = hardRuleFor(signals, rules.credential.length > 0, link);
        if (hardRule || tier(score, rulesScore) === "SCAM" || (reading.label === "scam" && rulesScore > 0)) {
          verdict = "SCAM";
          decidedBy = "ai";
        }
      }
    }
    degraded = ai.status !== "ok";
  }

  const payments = signals.filter((s) => s.type === "payment");
  return {
    verdict,
    score: verdict === "SCAM" ? Math.max(score, SCAM_AT) : score,
    rulesScore,
    modelScore,
    hardRule,
    decidedBy,
    signals: signals.sort((a, b) => a.start - b.start),
    hardPhrases: hardRule === "credential_request" ? rules.credential : [],
    link,
    family: verdict === "SAFE" ? null : detectFamily(rules.normalized.text),
    amount: verdict === "SAFE" ? null : findAmount(text, payments),
    payee: verdict === "SAFE" ? null : findPayee(rules.normalized.text),
    modelTerms: rulesScore === 0 && gate ? explainTerms(gate.topTerms.map((t) => t.term)) : [],
    ai,
    degraded,
    novel: decidedBy === "ai" && nothingMatched,
  };
}

// Words the model leans on that say nothing to a person ("sir", "this is").
const STOP = new Set(
  "a an and are as at be by dear for from has have hello hi i in is it its me my of on or our please sir sirji madam that the this to us was we will with you your aap aapka aapke hai ka ke ki ko se par kar".split(" "),
);
const PLACEHOLDER = /\bx(?:url|handle|amount|phone|num)\b/;

/** Up to three model words worth showing when the rules found nothing. */
function explainTerms(terms: string[]) {
  return terms
    .filter((t) => !PLACEHOLDER.test(t) && t.split(" ").some((w) => w.length >= 4 && !STOP.has(w)) && !t.split(" ").some((w) => STOP.has(w)))
    .slice(0, 3);
}

function hardRuleFor(signals: Evidence[], credential: boolean, link: LinkInfo | null): HardRule | null {
  const types = new Set(signals.map((s) => s.type));
  if (types.has("secrecy") && types.has("payment")) return "secrecy_payment";
  if (credential) return "credential_request";
  if (link && (link.status === "lookalike" || link.status === "blocked")) return "bad_link";
  return null;
}

export function points(signals: Evidence[], link: LinkInfo | null) {
  const types = new Set<SignalType>(signals.map((s) => s.type));
  let total = 0;
  for (const t of types) total += SIGNAL_POINTS[t];
  return total + (link ? LINK_POINTS[link.status] : 0);
}

function tier(score: number, rulesScore: number): Verdict {
  if (score >= SCAM_AT && rulesScore > 0) return "SCAM";
  if (score >= SUSPICIOUS_AT) return "SUSPICIOUS";
  return "SAFE";
}

function mergeEvidence(a: Evidence[], b: Evidence[]) {
  const out = [...a];
  for (const e of b) {
    if (!out.some((x) => x.type === e.type && x.start < e.end && e.start < x.end)) out.push(e);
  }
  return out;
}
