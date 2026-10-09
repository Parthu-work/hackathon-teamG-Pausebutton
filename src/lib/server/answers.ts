import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { AnswerView } from "@/lib/views";
import { logEvent } from "./events";
import { notifyOwnerOfAnswer } from "./notify";
import { HttpError } from "./session";

// Several trusted people can be alerted about one message (Arjun and Meera).
//  - One "it's a scam" (or Block) settles it as a scam, straight away.
//  - "Not a scam" (or Approve) only counts once EVERYONE who was alerted says so.
// Until then the message keeps its automatic verdict and shows who we wait for.

type User = typeof schema.users.$inferSelect;
type Check = typeof schema.checks.$inferSelect;
export type FamilyAnswer = "scam" | "not_scam";

const joinNames = (names: string[]) =>
  names.length <= 1 ? names[0] ?? "" : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

/** The people who were alerted or asked about this message, in the order they were told. */
export async function recipientsOf(db: Db, checkId: string): Promise<string[]> {
  const rows = await db.query.alerts.findMany({ where: eq(schema.alerts.checkId, checkId), orderBy: asc(schema.alerts.createdAt) });
  return [...new Set(rows.map((r) => r.recipientId))];
}

/** Who answered what, and who we are still waiting for. */
export async function answerSummary(db: Db, checkId: string) {
  const [recipients, rows] = await Promise.all([
    recipientsOf(db, checkId),
    db.query.answers.findMany({ where: eq(schema.answers.checkId, checkId), orderBy: asc(schema.answers.createdAt) }),
  ]);
  const ids = [...new Set([...recipients, ...rows.map((r) => r.memberId)])];
  const users = ids.length ? await db.query.users.findMany({ where: inArray(schema.users.id, ids) }) : [];
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "Family";
  const answers: AnswerView[] = rows.map((r) => ({ memberId: r.memberId, name: name(r.memberId), verdict: r.verdict, at: r.createdAt.toISOString() }));
  const scam = answers.filter((a) => a.verdict === "scam");
  const everyoneFine = recipients.length > 0 && recipients.every((id) => answers.some((a) => a.memberId === id && a.verdict === "not_scam"));
  const final: FamilyAnswer | null = scam.length ? "scam" : everyoneFine ? "not_scam" : null;
  return {
    recipients,
    answers,
    final,
    /** Names behind the final answer: who said scam, or everyone who said it is fine. */
    decidedBy: final === "scam" ? scam.map((a) => a.name) : final === "not_scam" ? answers.filter((a) => a.verdict === "not_scam").map((a) => a.name) : [],
    waitingFor: final ? [] : recipients.filter((id) => !answers.some((a) => a.memberId === id)).map(name),
  };
}

/**
 * Records one member's answer and settles the message if it can be settled.
 * Changing an answer is only allowed towards "scam" (the safer side).
 */
export async function giveAnswer(db: Db, member: User, check: Check, verdict: FamilyAnswer, opts: { viaHold?: string } = {}) {
  if (check.familyVerdict) {
    throw new HttpError(409, `This message is already decided: ${check.familyVerdict === "scam" ? "a scam" : "not a scam"}.`);
  }
  const recipients = await recipientsOf(db, check.id);
  if (verdict === "not_scam" && !recipients.includes(member.id)) {
    throw new HttpError(403, "Only the people who were alerted about this message can say it is safe.");
  }
  const mine = await db.query.answers.findFirst({
    where: and(eq(schema.answers.checkId, check.id), eq(schema.answers.memberId, member.id)),
  });
  if (mine && mine.verdict !== verdict) {
    if (verdict === "not_scam") throw new HttpError(409, "You already said it is a scam.");
    await db.update(schema.answers).set({ verdict, createdAt: new Date() }).where(eq(schema.answers.id, mine.id));
  } else if (!mine) {
    await db.insert(schema.answers).values({ checkId: check.id, memberId: member.id, verdict }).onConflictDoNothing();
  }
  // This member has dealt with their alert.
  await db
    .update(schema.alerts)
    .set({ handledAt: new Date(), openedAt: new Date() })
    .where(and(eq(schema.alerts.checkId, check.id), eq(schema.alerts.recipientId, member.id), isNull(schema.alerts.handledAt)));

  const summary = await settle(db, check, opts);
  if (!opts.viaHold) {
    const waiting = summary.waitingFor.length ? ` · waiting for ${joinNames(summary.waitingFor)}` : "";
    await logEvent(db, check.userId, member.name, "answer", `${member.name} said: ${verdict === "scam" ? "it's a scam" : "not a scam"}${waiting}`);
  }
  return summary;
}

/** If the family's answer is now final, store it and apply it to any paused payment. */
async function settle(db: Db, check: Check, opts: { viaHold?: string }) {
  const summary = await answerSummary(db, check.id);
  if (!summary.final) return summary;

  const deciderName = summary.decidedBy[summary.decidedBy.length - 1];
  const decider = summary.answers.find((a) => a.name === deciderName && a.verdict === summary.final)!;
  const [stored] = await db
    .update(schema.checks)
    .set({ familyVerdict: summary.final, familyVerdictBy: decider.memberId, familyVerdictAt: new Date() })
    .where(and(eq(schema.checks.id, check.id), isNull(schema.checks.familyVerdict)))
    .returning();
  if (!stored) return summary; // someone else settled it a moment ago

  // The money follows the family: a scam answer blocks a paused payment, everyone saying fine releases it.
  const status = summary.final === "scam" ? "blocked" : "approved";
  const held = await db
    .update(schema.holds)
    .set({ status, decidedById: decider.memberId, decidedAt: new Date() })
    .where(and(eq(schema.holds.checkId, check.id), eq(schema.holds.status, "pending")))
    .returning();
  await db
    .update(schema.alerts)
    .set({ handledAt: new Date() })
    .where(and(eq(schema.alerts.checkId, check.id), isNull(schema.alerts.handledAt)));

  const who = joinNames(summary.decidedBy);
  for (const h of held) {
    if (h.id === opts.viaHold) continue; // the payment screen logs its own line
    await logEvent(db, check.userId, who, status, `Payment ${status === "blocked" ? "blocked" : "released"} because ${who} ${summary.final === "scam" ? "said it is a scam" : "said it is fine"} · status ${status}`, h.id);
  }
  await logEvent(
    db,
    check.userId,
    who,
    "family_verdict",
    summary.final === "scam" ? `Family answer: SCAM (${who})` : `Family answer: not a scam (everyone agreed: ${who})`,
  );
  // Papa may be in another app (or on the call with the scammer): tell his phone.
  await notifyOwnerOfAnswer(db, check, summary.final, summary.decidedBy, held);
  return summary;
}
