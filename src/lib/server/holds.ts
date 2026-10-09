import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { HOLD_MINUTES } from "@/lib/check/config";
import { keyPhrases } from "@/lib/check/phrases";
import { rupees } from "@/lib/check/copy";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { AdviceView, HoldStatus, HoldView } from "@/lib/views";
import { answerSummary, giveAnswer } from "./answers";
import { ownerView } from "./people";
import { logEvent } from "./events";
import { notifyOwnerOfAdvice } from "./notify";
import { HttpError } from "./session";

type Hold = typeof schema.holds.$inferSelect;
type Check = typeof schema.checks.$inferSelect;
type User = typeof schema.users.$inferSelect;

/** Expired is derived: a pending hold past its time. Money stays held either way. */
const joinNames = (names: string[]) =>
  names.length <= 1 ? names[0] ?? "" : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

export function holdStatus(h: Hold, now = Date.now()): HoldStatus {
  if (h.status === "pending" && h.expiresAt.getTime() <= now) return "expired";
  return h.status;
}

export async function createHold(db: Db, check: Check, owner: User) {
  const [hold] = await db
    .insert(schema.holds)
    .values({
      checkId: check.id,
      userId: owner.id,
      payee: check.payee ?? "Unknown account",
      amount: check.amount ?? 0,
      expiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
    })
    .returning();
  return hold;
}

export async function adviceFor(db: Db, where: { checkId?: string; holdId?: string }): Promise<AdviceView[]> {
  const rows = await db.query.advice.findMany({
    where: where.holdId ? eq(schema.advice.holdId, where.holdId) : eq(schema.advice.checkId, where.checkId!),
    orderBy: desc(schema.advice.createdAt),
  });
  if (!rows.length) return [];
  const names = await userNames(db, rows.map((r) => r.fromUserId));
  return rows.map((r) => ({ id: r.id, fromName: names[r.fromUserId] ?? "Family", text: r.text, createdAt: r.createdAt.toISOString() }));
}

export async function userNames(db: Db, ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await db.query.users.findMany({ where: inArray(schema.users.id, unique) });
  return Object.fromEntries(rows.map((u) => [u.id, u.name]));
}

export async function toHoldView(db: Db, hold: Hold, check?: Check): Promise<HoldView> {
  const c = check ?? (await db.query.checks.findFirst({ where: eq(schema.checks.id, hold.checkId) }))!;
  const owner = (await db.query.users.findFirst({ where: eq(schema.users.id, hold.userId) }))!;
  const names = await userNames(db, hold.decidedById ? [hold.decidedById] : []);
  const family = await answerSummary(db, c.id);
  const approvedBy = family.answers.filter((a) => a.verdict === "not_scam").map((a) => a.name);
  const decidedByName =
    hold.status === "approved" && approvedBy.length
      ? joinNames(approvedBy)
      : hold.decidedById
        ? names[hold.decidedById] ?? null
        : null;
  return {
    id: hold.id,
    checkId: hold.checkId,
    payee: hold.payee,
    amount: hold.amount,
    status: holdStatus(hold),
    expiresAt: hold.expiresAt.toISOString(),
    createdAt: hold.createdAt.toISOString(),
    decidedByName,
    decidedAt: hold.decidedAt?.toISOString() ?? null,
    outcomeSeen: !!hold.outcomeSeenAt,
    approvedBy,
    waitingFor: hold.status === "pending" ? family.waitingFor : [],
    phrases: keyPhrases(c.signals, c.link, c.hardPhrases),
    checkTitle: c.title,
    verdict: c.verdict,
    advice: await adviceFor(db, { holdId: hold.id }),
    owner: ownerView(owner),
  };
}

export async function latestHoldFor(db: Db, userId: string, status: Hold["status"][]) {
  return db.query.holds.findFirst({
    where: and(eq(schema.holds.userId, userId), inArray(schema.holds.status, status)),
    orderBy: desc(schema.holds.createdAt),
  });
}

/** Is this family member linked to the person who owns the hold? */
export async function assertLinked(db: Db, member: User, protectedId: string) {
  const link = await db.query.links.findFirst({
    where: and(eq(schema.links.protectedId, protectedId), eq(schema.links.familyId, member.id), eq(schema.links.status, "linked")),
  });
  if (!link) throw new HttpError(403, "You are not linked to this person.");
  return link;
}

/**
 * I2/I3: Block, or Approve with a second confirm. One Block blocks the payment
 * straight away; it is released only when everyone who was alerted approves.
 */
export async function decideHold(db: Db, member: User, holdId: string, decision: "block" | "approve", confirm: boolean) {
  const hold = await db.query.holds.findFirst({ where: eq(schema.holds.id, holdId) });
  if (!hold) throw new HttpError(404, "That payment was not found.");
  await assertLinked(db, member, hold.userId);
  if (decision === "approve" && !confirm) throw new HttpError(400, "Approving needs a second confirm.");
  if (hold.status !== "pending") {
    const view = await toHoldView(db, hold);
    throw new HttpError(409, `${view.decidedByName ?? "Someone"} already ${hold.status} this payment.`);
  }
  const check = (await db.query.checks.findFirst({ where: eq(schema.checks.id, hold.checkId) }))!;
  const summary = await giveAnswer(db, member, check, decision === "block" ? "scam" : "not_scam", { viaHold: holdId });

  const updated = (await db.query.holds.findFirst({ where: eq(schema.holds.id, holdId) }))!;
  const message =
    decision === "block"
      ? `${member.name} tapped Block · status ${updated.status}`
      : updated.status === "approved"
        ? `${member.name} tapped Approve · everyone approved · status approved`
        : `${member.name} tapped Approve · waiting for ${summary.waitingFor.join(" and ")}`;
  await logEvent(db, hold.userId, member.name, decision === "block" ? "blocked" : updated.status === "approved" ? "approved" : "approve_vote", message, holdId);
  return toHoldView(db, updated, check);
}

export async function addAdvice(db: Db, member: User, target: { holdId?: string; checkId?: string }, text: string) {
  let checkId = target.checkId;
  let ownerId: string;
  if (target.holdId) {
    const hold = await db.query.holds.findFirst({ where: eq(schema.holds.id, target.holdId) });
    if (!hold) throw new HttpError(404, "That payment was not found.");
    checkId = hold.checkId;
    ownerId = hold.userId;
  } else {
    const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, checkId!) });
    if (!check) throw new HttpError(404, "That message was not found.");
    ownerId = check.userId;
  }
  await assertLinked(db, member, ownerId);
  const [row] = await db.insert(schema.advice).values({ checkId: checkId!, holdId: target.holdId ?? null, fromUserId: member.id, text }).returning();
  await logEvent(db, ownerId, member.name, "advice", `${member.name} sent advice: “${text}”`, target.holdId ?? null);
  await notifyOwnerOfAdvice(db, row, ownerId, member.name);
}

/** G2 "Cancel this payment" by Mr Rao himself. */
export async function cancelHold(db: Db, owner: User, holdId: string) {
  const [row] = await db
    .update(schema.holds)
    .set({ status: "cancelled", decidedById: owner.id, decidedAt: new Date(), outcomeSeenAt: new Date() })
    .where(and(eq(schema.holds.id, holdId), eq(schema.holds.userId, owner.id), eq(schema.holds.status, "pending")))
    .returning();
  if (!row) throw new HttpError(409, "This payment is no longer waiting.");
  await db
    .update(schema.alerts)
    .set({ handledAt: new Date() })
    .where(and(eq(schema.alerts.holdId, holdId), isNull(schema.alerts.handledAt)));
  await logEvent(db, owner.id, owner.name, "cancelled", `${owner.name} cancelled the ${rupees(row.amount)} payment`, holdId);
}

export async function markOutcomeSeen(db: Db, owner: User, holdId: string) {
  const [row] = await db
    .update(schema.holds)
    .set({ outcomeSeenAt: new Date() })
    .where(and(eq(schema.holds.id, holdId), eq(schema.holds.userId, owner.id), isNull(schema.holds.outcomeSeenAt)))
    .returning();
  if (row && row.status !== "pending") {
    const label = row.status === "blocked" ? "Payment cancelled" : row.status === "approved" ? "Payment released" : "Payment cancelled";
    await logEvent(db, owner.id, owner.name, "outcome_seen", `${owner.name}'s phone showed: ${label}`, holdId);
  }
}
