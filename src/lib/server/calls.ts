import { SCAM_AT, SUSPICIOUS_AT } from "@/lib/check/config";
import { checkMessage } from "@/lib/check/pipeline";
import type { CallAnswers, CheckResult } from "@/lib/check/types";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { logEvent } from "./events";
import { storeCheck } from "./checks";

type User = typeof schema.users.$inferSelect;

// F6 · Live-call guard: the scam with no message. Mr Rao answers three large
// questions while the caller is still on the line. His answers become a short
// account of the call, which goes through the same rules (so the family reads
// it with the warning phrases marked), and any "yes" convicts the call:
// real police never video-call, never ask for money, never ask for secrecy.

export const CALL_QUESTIONS = ["video", "money", "secrecy"] as const;

/** The call as a sentence or two, in the words the rules know. */
export function describeCall(a: CallAnswers) {
  const parts = ["Someone is calling me and says they are an officer."];
  if (a.video) parts.push("They video-called me and said I am in trouble.");
  if (a.money) parts.push("They asked me to send money now.");
  if (a.secrecy) parts.push("They said: do not tell anyone and stay on the call.");
  if (!a.video && !a.money && !a.secrecy) parts.push("They have not asked for money or secrecy yet.");
  return parts.join(" ");
}

export async function createCallCheck(db: Db, owner: User, answers: CallAnswers) {
  const text = describeCall(answers);
  const base = await checkMessage(text, { ai: "off" });
  const yes = CALL_QUESTIONS.filter((q) => answers[q]).length;
  const result: CheckResult =
    yes > 0
      ? { ...base, verdict: "SCAM", hardRule: "live_call", decidedBy: "hard_rule", score: Math.max(base.score, SCAM_AT), family: "fake_officer", degraded: false, ai: { status: "not_needed" }, novel: false }
      : { ...base, verdict: "SUSPICIOUS", hardRule: null, decidedBy: "score", score: Math.max(base.score, SUSPICIOUS_AT), family: "fake_officer", degraded: false, ai: { status: "not_needed" }, novel: false };
  const stored = await storeCheck(db, owner, { text, source: "call", title: yes ? "Live call: fake officer" : "Live call", callAnswers: answers }, result, text);
  await logEvent(db, owner.id, owner.name, "call_guard", `${owner.name} used the call guard · video ${answers.video ? "yes" : "no"} · money ${answers.money ? "yes" : "no"} · secrecy ${answers.secrecy ? "yes" : "no"}`);
  return stored;
}
