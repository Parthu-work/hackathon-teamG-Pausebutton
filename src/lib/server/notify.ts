import { inArray } from "drizzle-orm";
import { rupees } from "@/lib/check/copy";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { logEvent } from "./events";
import { pushToUsers, type PushResult } from "./push";

// Push notifications to the protected person (Mr Rao) when his family acts:
// he may be on the phone with the scammer, in another app, with Pause Button
// closed. A tap opens the payment or the message the update is about.

type Check = typeof schema.checks.$inferSelect;
type Hold = typeof schema.holds.$inferSelect;

const names = (list: string[]) => (list.length <= 1 ? list[0] ?? "" : list.slice(0, -1).join(", ") + " and " + list[list.length - 1]);

/** A deep link into Mr Rao's app, resolved by /open (works signed in or not). */
export const raoLink = (path: string) => `/open?app=rao&to=${encodeURIComponent(path)}`;

/** The family's answer is final: a scam (one said so), or not a scam (everyone agreed). */
export async function notifyOwnerOfAnswer(db: Db, check: Check, final: "scam" | "not_scam", decidedBy: string[], holds: Hold[]) {
  const who = names(decidedBy);
  const hold = holds[0];
  const text = hold
    ? final === "scam"
      ? { title: `${who} blocked the payment`, body: `${rupees(hold.amount)} was not paid. Do not pay or reply to that message.` }
      : { title: "Payment released (demo)", body: `${who} checked it and said it is fine.` }
    : final === "scam"
      ? { title: `${who}: it is a scam`, body: "Do not reply, pay or tap any link in that message." }
      : { title: `${who} checked it: not a scam`, body: "Open to see what they said." };
  const { results } = await pushToUsers(
    db,
    [check.userId],
    { ...text, url: raoLink(hold ? `/hold/${hold.id}` : `/check/${check.id}`), tag: `rao-check-${check.id}`, urgent: final === "scam", app: "rao" },
    { dedupeKey: `answer:${check.id}`, householdId: check.userId },
  );
  await logPushOutcome(db, check.userId, results, hold?.id ?? null);
}

/** A family member sent advice ("Hang up. Do not pay."). */
export async function notifyOwnerOfAdvice(
  db: Db,
  advice: { id: string; checkId: string; holdId: string | null; text: string },
  ownerId: string,
  fromName: string,
) {
  const { results } = await pushToUsers(
    db,
    [ownerId],
    {
      title: `${fromName} says:`,
      body: advice.text,
      url: raoLink(advice.holdId ? `/hold/${advice.holdId}` : `/check/${advice.checkId}`),
      tag: `rao-check-${advice.checkId}`,
      urgent: true,
      app: "rao",
    },
    { dedupeKey: `advice:${advice.id}`, householdId: ownerId },
  );
  await logPushOutcome(db, ownerId, results, advice.holdId);
}

/**
 * One line in the event log per push: who got it on how many phones, and who
 * could not be reached, so the demo log (and debugging) shows why a phone stayed quiet.
 */
export async function logPushOutcome(db: Db, householdId: string, results: PushResult[], holdId: string | null = null) {
  if (!results.length) return; // push is not set up on this server
  const users = await db.query.users.findMany({ where: inArray(schema.users.id, results.map((r) => r.userId)) });
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "Family";
  const sent = results.filter((r) => r.status === "sent");
  const devices = sent.reduce((n, r) => n + r.delivered, 0);
  if (sent.length) {
    await logEvent(db, householdId, "Check service", "push", `Push notification sent to ${devices} phone${devices === 1 ? "" : "s"} (${names(sent.map((r) => name(r.userId)))})`, holdId);
  }
  const why: Partial<Record<PushResult["status"], string>> = {
    no_device: "no phone registered for notifications",
    disabled: "notifications turned off",
    retrying: "push service unavailable, retrying",
    failed: "push failed",
  };
  for (const r of results) {
    const reason = why[r.status];
    if (reason) await logEvent(db, householdId, "Check service", "push_failed", `Push not delivered to ${name(r.userId)}: ${reason}. They see it when they open the app.`, holdId);
  }
}
