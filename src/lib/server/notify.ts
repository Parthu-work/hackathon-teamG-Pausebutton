import { eq } from "drizzle-orm";
import { rupees } from "@/lib/check/copy";
import { keyPhrases } from "@/lib/check/phrases";
import { joinNamesIn, translator } from "@/lib/i18n";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { logEvent } from "./events";
import { pushToUsers, type PushResult } from "./push";

// Push notifications on the protected person's own phone, in his language
// (F5): a message the watcher caught while the app was closed, and what the
// family decided about a paused payment or a message he asked about.

type User = typeof schema.users.$inferSelect;
type Check = typeof schema.checks.$inferSelect;
type Hold = typeof schema.holds.$inferSelect;

/** One line in the demo log per outcome, so a missing notification can be traced (push_deliveries has the detail). */
export async function logPush(db: Db, householdId: string, r: PushResult, holdId: string | null = null) {
  const phones = (n: number) => `${n} phone${n === 1 ? "" : "s"}`;
  if (r.sent) await logEvent(db, householdId, "Check service", "push", `Push notification sent to ${phones(r.sent)}`, holdId);
  if (r.failed) await logEvent(db, householdId, "Check service", "push_failed", `Push notification failed for ${phones(r.failed)} · see push_deliveries`, holdId);
}

/** A message that arrived on his phone (watcher or simulated inbox) and is a SCAM or SUSPICIOUS: "Possible scam from …". */
export async function notifyOwnerOfMessage(db: Db, owner: User, check: Check) {
  if (check.verdict === "SAFE") return;
  const t = translator(owner.language);
  const phrases = keyPhrases(check.signals, check.link, check.hardPhrases, 2).map((p) => `“${p}”`).join(", ");
  const r = await pushToUsers(
    db,
    [owner.id],
    {
      title: t(check.verdict === "SCAM" ? "push.scamTitle" : "push.suspiciousTitle", { sender: check.senderLabel ?? "" }),
      body: phrases ? t("push.messageBody", { phrases: `${phrases}.` }) : t("push.messageBodyNoPhrases"),
      url: `/check/${check.id}`,
      tag: `check-${check.id}`,
      urgent: check.verdict === "SCAM",
      kind: "message",
      checkId: check.id,
      at: check.createdAt.toISOString(),
    },
    { key: `check:${check.id}`, checkId: check.id },
  );
  await logPush(db, owner.id, r);
}

/**
 * The family's answer is final: a paused payment was blocked or released, or
 * (with no payment) they said scam / not a scam. `who` are the names behind it.
 */
export async function notifyOwnerOfOutcome(db: Db, check: Check, final: "scam" | "not_scam", who: string[], holds: Hold[]) {
  const owner = await db.query.users.findFirst({ where: eq(schema.users.id, check.userId) });
  if (!owner) return;
  const t = translator(owner.language);
  const names = joinNamesIn(t, who);
  const at = new Date().toISOString();
  if (holds.length) {
    for (const h of holds) {
      const blocked = h.status === "blocked";
      const r = await pushToUsers(
        db,
        [owner.id],
        {
          title: t(blocked ? "push.blockedTitle" : "push.releasedTitle"),
          body: t(blocked ? "push.blockedBody" : "push.releasedBody", { who: names, amount: rupees(h.amount) }),
          url: `/hold/${h.id}`,
          tag: `hold-${h.id}`,
          urgent: true,
          kind: "outcome",
          checkId: check.id,
          holdId: h.id,
          at,
        },
        { key: `hold:${h.id}:${h.status}`, checkId: check.id },
      );
      await logPush(db, owner.id, r, h.id);
    }
    return;
  }
  const scam = final === "scam";
  const r = await pushToUsers(
    db,
    [owner.id],
    {
      title: t(scam ? "push.verdictScamTitle" : "push.verdictFineTitle", { who: names }),
      body: t(scam ? "push.verdictScamBody" : "push.verdictFineBody"),
      url: `/check/${check.id}`,
      tag: `check-${check.id}`,
      urgent: false,
      kind: "outcome",
      checkId: check.id,
      at,
    },
    { key: `verdict:${check.id}`, checkId: check.id },
  );
  await logPush(db, owner.id, r);
}
