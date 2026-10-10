import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { finalVerdict } from "@/lib/check/final";
import { keyPhrases } from "@/lib/check/phrases";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { SimMessageView, SimStatus } from "@/lib/views";
import simData from "@/data/sim-messages.json";
import { createCheck, failureCode, sharedText } from "./checks";
import { logEvent } from "./events";
import { log } from "./log";
import { HttpError } from "./session";

type User = typeof schema.users.$inferSelect;
type SimRow = typeof schema.simMessages.$inferSelect;
export type SimInput = { channel: "sms" | "whatsapp"; sender: string; fromContact: boolean; text: string };
/** What became of a message: its inbox row and check. duplicate: the phone had posted it already. */
export type Delivery = { id: string | null; checkId: string | null; status: SimStatus; duplicate: boolean };

// The simulated inbox stands in for the phone's own SMS and WhatsApp apps.
// A message that "arrives" here goes through the same check as a pasted one.
// The Android watcher's real messages come through here too (devices.ts):
// - exactly once: the phone's id for a message (deviceMessageId) makes a
//   repeated post return the first result, and the check and the row's
//   "checked" mark are stored together, so no retry can check it twice;
// - a real message keeps its text here only until it is checked (24 hours at
//   most, see purgeSharedText): a scam or suspicious message's text then lives
//   on its check for 24 hours (sharedText), a safe one's is not stored, and one
//   that is not checked (not watched, or from a saved contact) is not stored at all;
// - when the check itself fails, the row says so ("failed") and keeps the
//   text, and the 30-minute sync job (sync.ts) or Mr Rao's tap tries again.

/** synthetic: a made-up message from the demo library, whose text is kept so the demo inbox reads like a phone. */
export async function deliverMessage(
  db: Db,
  owner: User,
  msg: SimInput,
  opts: { synthetic?: boolean; deviceMessageId?: string | null } = {},
): Promise<Delivery> {
  const synthetic = opts.synthetic ?? false;
  const channel = msg.channel === "sms" ? "SMS" : "WhatsApp";
  const watched = msg.channel === "sms" ? owner.watchSms : owner.watchWhatsapp;
  const skipped = !watched || (msg.fromContact && owner.unknownOnly);

  if (!synthetic && skipped) {
    // Not checked, so nothing is kept: not even the sender, who may be a saved contact.
    await logEvent(db, owner.id, "Watcher", "sim_arrived", `${channel} arrived on ${owner.name}'s phone · not checked`);
    return { id: null, checkId: null, status: "skipped", duplicate: false };
  }

  const key = synthetic ? null : (opts.deviceMessageId ?? null);
  if (key) {
    const seen = await byDeviceMessageId(db, owner.id, key);
    if (seen) return duplicateOf(seen);
  }
  const now = new Date();
  const [row] = await db
    .insert(schema.simMessages)
    .values({
      userId: owner.id,
      ...msg,
      synthetic,
      deviceMessageId: key,
      status: skipped ? "skipped" : "received",
      attempts: skipped ? 0 : 1,
      lastTriedAt: skipped ? null : now,
    })
    .onConflictDoNothing({ target: [schema.simMessages.userId, schema.simMessages.deviceMessageId] })
    .returning();
  if (!row) return duplicateOf(await byDeviceMessageId(db, owner.id, key!)); // the same post, at the same moment

  log.info("inbox_received", { simMessageId: row.id, userId: owner.id, channel: msg.channel, synthetic, keyed: !!key });
  await logEvent(db, owner.id, synthetic ? "Simulator" : "Watcher", "sim_arrived", `${channel} arrived on ${owner.name}'s phone from ${msg.sender}`);
  if (skipped) return { id: row.id, checkId: null, status: "skipped", duplicate: false }; // a demo message that is not checked (SKIPPED)
  return checkRow(db, owner, row);
}

const byDeviceMessageId = (db: Db, userId: string, key: string) =>
  db.query.simMessages.findFirst({ where: and(eq(schema.simMessages.userId, userId), eq(schema.simMessages.deviceMessageId, key)) });

/** The row as it is now, for a post or try that found it already handled; none if it was deleted meanwhile (Delete my history). */
function duplicateOf(row: SimRow | undefined): Delivery {
  if (!row) return { id: null, checkId: null, status: "skipped", duplicate: true };
  log.info("inbox_duplicate", { simMessageId: row.id, userId: row.userId, status: row.status });
  return { id: row.id, checkId: row.checkId, status: row.status, duplicate: true };
}

/** Thrown inside the check's transaction when the row was checked (or deleted) meanwhile: the new check is rolled back. */
class AlreadyChecked extends Error {
  constructor(readonly row: SimRow | undefined) {
    super("already checked");
  }
}

/**
 * Checks an inbox row whose try has started (attempts counts it). The check
 * and the row's "checked" mark (text cleared, unless it is a demo message)
 * are one transaction, so a row can only ever get one check. If the check
 * fails before it is stored, the row is "failed" and keeps its text.
 */
async function checkRow(db: Db, owner: User, row: SimRow): Promise<Delivery> {
  const started = Date.now();
  const m = schema.simMessages;
  try {
    const { checkId, verdict } = await createCheck(
      db,
      owner,
      { text: row.text!, source: row.channel, senderLabel: row.sender },
      {
        onStored: async (tx, checkId) => {
          const [current] = await tx.select().from(m).where(eq(m.id, row.id)).for("update");
          if (!current || current.checkId) throw new AlreadyChecked(current);
          await tx
            .update(m)
            .set({ status: "checked", checkId, error: null, text: row.synthetic ? row.text : null })
            .where(eq(m.id, row.id));
        },
      },
    );
    log.info("inbox_checked", { simMessageId: row.id, checkId, verdict, attempts: row.attempts, ms: Date.now() - started });
    return { id: row.id, checkId, status: "checked", duplicate: false };
  } catch (error) {
    if (error instanceof AlreadyChecked) return duplicateOf(error.row);
    const code = failureCode(error);
    await db
      .update(m)
      .set({ status: "failed", error: code })
      .where(and(eq(m.id, row.id), isNull(m.checkId)));
    log.error("inbox_failed", { simMessageId: row.id, userId: owner.id, attempts: row.attempts, error: code, ms: Date.now() - started });
    return { id: row.id, checkId: null, status: "failed", duplicate: false };
  }
}

/** Mr Rao taps "We could not check this message": his own message, while its text is kept. */
export async function retryMessage(db: Db, owner: User, id: string): Promise<Delivery> {
  const row = await db.query.simMessages.findFirst({ where: and(eq(schema.simMessages.id, id), eq(schema.simMessages.userId, owner.id)) });
  if (!row) throw new HttpError(404, "Message not found.");
  if (row.checkId || row.status === "checked" || row.status === "skipped") return { id: row.id, checkId: row.checkId, status: row.status, duplicate: true };
  if (!row.text) throw new HttpError(410, "This message's text is no longer kept, so it cannot be checked again.");
  return checkAgain(db, owner, row);
}

/**
 * Tries a message's check again (Mr Rao's tap, or the sync job, which stops
 * after maxAttempts tries). The try is counted and the row reads "being
 * checked" until it ends; a row that was checked meanwhile, or lost its text
 * to the purge, is left as it is.
 */
export async function checkAgain(db: Db, owner: User, row: SimRow, maxAttempts = Infinity): Promise<Delivery> {
  const m = schema.simMessages;
  const [claimed] = await db
    .update(m)
    .set({ status: "received", attempts: sql`${m.attempts} + 1`, lastTriedAt: new Date() })
    .where(and(eq(m.id, row.id), isNull(m.checkId), isNotNull(m.text), Number.isFinite(maxAttempts) ? lt(m.attempts, maxAttempts) : undefined))
    .returning();
  if (!claimed) return duplicateOf(await db.query.simMessages.findFirst({ where: eq(m.id, row.id) }));
  return checkRow(db, owner, claimed);
}

/** P1 "Receive a test scam message": the next message from the demo library. */
export async function receiveNext(db: Db, owner: User) {
  const have = await db.query.simMessages.findMany({ where: eq(schema.simMessages.userId, owner.id) });
  const library = simData.library as SimInput[];
  const next = library.find((m) => !have.some((h) => h.text === m.text)) ?? library[have.length % library.length];
  return deliverMessage(db, owner, next, { synthetic: true });
}

export async function seedInbox(db: Db, owner: User) {
  for (const m of simData.seed as SimInput[]) {
    const row = await deliverMessage(db, owner, m, { synthetic: true });
    await db.update(schema.simMessages).set({ bannerSeenAt: new Date() }).where(eq(schema.simMessages.id, row.id!));
  }
}

export async function listInbox(db: Db, ownerId: string): Promise<SimMessageView[]> {
  const rows = await db.query.simMessages.findMany({ where: eq(schema.simMessages.userId, ownerId), orderBy: desc(schema.simMessages.createdAt) });
  return toViews(db, rows);
}

/** The "Possible scam" banner: the latest checked message that is a scam or suspicious (a failed one never is). */
export async function latestBanner(db: Db, ownerId: string): Promise<SimMessageView | null> {
  const rows = await db.query.simMessages.findMany({
    where: and(eq(schema.simMessages.userId, ownerId), eq(schema.simMessages.status, "checked"), isNull(schema.simMessages.bannerSeenAt)),
    orderBy: desc(schema.simMessages.createdAt),
    limit: 5,
  });
  const views = await toViews(db, rows);
  return views.find((v) => v.verdict === "SCAM" || v.verdict === "SUSPICIOUS") ?? null;
}

export async function markBannerSeen(db: Db, owner: User, id: string) {
  const [row] = await db
    .update(schema.simMessages)
    .set({ bannerSeenAt: new Date() })
    .where(and(eq(schema.simMessages.id, id), eq(schema.simMessages.userId, owner.id)))
    .returning();
  if (!row) throw new HttpError(404, "Message not found.");
}

async function toViews(db: Db, rows: SimRow[]): Promise<SimMessageView[]> {
  const ids = rows.map((r) => r.checkId).filter((x): x is string => !!x);
  const checks = ids.length ? await db.query.checks.findMany({ where: inArray(schema.checks.id, ids) }) : [];
  return rows.map((r) => {
    const c = checks.find((x) => x.id === r.checkId);
    return {
      id: r.id,
      channel: r.channel,
      sender: r.sender,
      fromContact: r.fromContact,
      // A real message shows its check's text while that is kept (24 h, scam or suspicious only).
      // One still waiting for its check shows none: its text is kept only to check it.
      text: r.synthetic ? r.text : c ? sharedText(c) : null,
      createdAt: r.createdAt.toISOString(),
      checkId: r.checkId,
      // "Not watched" / "Skipped" only for a message that really was not checked, never for one that failed.
      verdict: c ? finalVerdict(c.verdict, c.familyVerdict) : r.status === "skipped" && r.fromContact ? "SKIPPED" : null,
      phrases: c ? keyPhrases(c.signals, c.link, c.hardPhrases, 2) : [],
      status: r.status,
      canRetry: r.status === "failed" && !r.checkId && !!r.text,
    };
  });
}
