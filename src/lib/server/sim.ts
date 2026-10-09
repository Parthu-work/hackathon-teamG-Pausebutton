import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { finalVerdict } from "@/lib/check/final";
import { keyPhrases } from "@/lib/check/phrases";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { SimMessageView } from "@/lib/views";
import simData from "@/data/sim-messages.json";
import { createCheck, sharedText } from "./checks";
import { logEvent } from "./events";
import { HttpError } from "./session";

type User = typeof schema.users.$inferSelect;
type SimRow = typeof schema.simMessages.$inferSelect;
export type SimInput = { channel: "sms" | "whatsapp"; sender: string; fromContact: boolean; text: string };

// The simulated inbox stands in for the phone's own SMS and WhatsApp apps.
// A message that "arrives" here goes through the same check as a pasted one.
// The Android watcher's real messages come through here too (devices.ts), but
// keep no text in this table: a scam or suspicious message's text lives on its
// check for 24 hours (sharedText), a safe one's is never stored, and one that
// is not checked (not watched, or from a saved contact) is not stored at all.

/** synthetic: a made-up message from the demo library, whose text is kept so the demo inbox reads like a phone. */
export async function deliverMessage(db: Db, owner: User, msg: SimInput, opts: { synthetic?: boolean } = {}) {
  const synthetic = opts.synthetic ?? false;
  const channel = msg.channel === "sms" ? "SMS" : "WhatsApp";
  const watched = msg.channel === "sms" ? owner.watchSms : owner.watchWhatsapp;
  const skipped = !watched || (msg.fromContact && owner.unknownOnly);

  if (!synthetic) {
    if (skipped) {
      // Not checked, so nothing is kept: not even the sender, who may be a saved contact.
      await logEvent(db, owner.id, "Watcher", "sim_arrived", `${channel} arrived on ${owner.name}'s phone · not checked`);
      return { id: null, checkId: null };
    }
    await logEvent(db, owner.id, "Watcher", "sim_arrived", `${channel} arrived on ${owner.name}'s phone from ${msg.sender}`);
    const { checkId } = await createCheck(db, owner, { text: msg.text, source: msg.channel, senderLabel: msg.sender });
    const [row] = await db
      .insert(schema.simMessages)
      .values({ userId: owner.id, channel: msg.channel, sender: msg.sender, fromContact: msg.fromContact, text: null, checkId })
      .returning();
    return { id: row.id, checkId };
  }

  const [row] = await db.insert(schema.simMessages).values({ userId: owner.id, ...msg, synthetic: true }).returning();
  await logEvent(db, owner.id, "Simulator", "sim_arrived", `${channel} arrived on ${owner.name}'s phone from ${msg.sender}`);
  if (skipped) return { id: row.id, checkId: null }; // not checked (SKIPPED)

  const { checkId } = await createCheck(db, owner, { text: msg.text, source: msg.channel, senderLabel: msg.sender });
  await db.update(schema.simMessages).set({ checkId }).where(eq(schema.simMessages.id, row.id));
  return { id: row.id, checkId };
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

export async function latestBanner(db: Db, ownerId: string): Promise<SimMessageView | null> {
  const rows = await db.query.simMessages.findMany({
    where: and(eq(schema.simMessages.userId, ownerId), isNull(schema.simMessages.bannerSeenAt)),
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
      text: r.synthetic ? r.text : c ? sharedText(c) : null,
      createdAt: r.createdAt.toISOString(),
      checkId: r.checkId,
      verdict: c ? finalVerdict(c.verdict, c.familyVerdict) : r.fromContact ? "SKIPPED" : null,
      phrases: c ? keyPhrases(c.signals, c.link, c.hardPhrases, 2) : [],
    };
  });
}
