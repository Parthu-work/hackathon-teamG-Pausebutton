import crypto from "node:crypto";
import { and, asc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { DeviceView } from "@/lib/views";
import { logEvent } from "./events";
import { HttpError } from "./session";
import { deliverMessage, type SimInput } from "./sim";

// The Android app's message watcher (screens M1–M4). The web app shows a
// pairing code; the phone exchanges it for a token it keeps for good, then
// posts every incoming SMS / WhatsApp notification to /api/device/inbox,
// which runs the same check as a pasted message. Every 30 minutes its
// SyncWorker posts what is still waiting and reports in (/api/device/status
// with sync); the server's sync job flags a phone that stops reporting.

type User = typeof schema.users.$inferSelect;
type Device = typeof schema.devices.$inferSelect;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_MINUTES = 15;
export const ANDROID_PACKAGE = process.env.ANDROID_PACKAGE ?? "ai.apty.pausebutton";

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function toDeviceView(d: Device): DeviceView {
  return {
    id: d.id,
    name: d.name,
    paired: !!d.pairedAt,
    pairingCode: d.pairedAt ? null : d.pairingCode,
    pairingExpiresAt: d.pairingExpiresAt?.toISOString() ?? null,
    pairedAt: d.pairedAt?.toISOString() ?? null,
    online: !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < 5 * 60_000,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    lastMessageAt: d.lastMessageAt?.toISOString() ?? null,
    listenerOn: d.listenerOn,
    messagesSeen: d.messagesSeen,
    notSyncing: !!d.notSyncingSince,
    lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
    waiting: d.waiting,
  };
}

/** How a person's watcher looks to their family: no phone paired, fine, or quiet (no report for over an hour). */
export function watcherStatus(paired: Pick<Device, "pairedAt" | "notSyncingSince">[]): "none" | "ok" | "quiet" {
  const phones = paired.filter((d) => d.pairedAt);
  if (!phones.length) return "none";
  return phones.every((d) => d.notSyncingSince) ? "quiet" : "ok";
}

/** M2 "Connect this phone": a code (and a link that opens the app) valid for 15 minutes. */
export async function createPairing(db: Db, owner: User, origin: string) {
  // One open code per person: a fresh request replaces an unused one.
  await db.delete(schema.devices).where(and(eq(schema.devices.userId, owner.id), isNull(schema.devices.pairedAt)));
  const code = [...crypto.randomBytes(6)].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
  const [row] = await db
    .insert(schema.devices)
    .values({ userId: owner.id, pairingCode: code, pairingExpiresAt: new Date(Date.now() + PAIRING_MINUTES * 60_000) })
    .returning();
  await logEvent(db, owner.id, owner.name, "device_pairing", `${owner.name} asked to connect an Android phone`);
  return {
    code,
    expiresAt: row.pairingExpiresAt!.toISOString(),
    link: `pausebutton://pair?code=${code}&host=${encodeURIComponent(origin)}`,
    host: origin,
  };
}

/** The phone trades the code for its token. The token is shown once and never stored in clear. */
export async function pairDevice(db: Db, rawCode: string, name: string) {
  const code = rawCode.trim().toUpperCase();
  const row = await db.query.devices.findFirst({
    where: and(eq(schema.devices.pairingCode, code), isNull(schema.devices.pairedAt), gt(schema.devices.pairingExpiresAt, new Date())),
  });
  if (!row) throw new HttpError(400, "That code did not work. Ask for a new one on the phone you are protecting.");
  const token = crypto.randomBytes(32).toString("base64url");
  await db
    .update(schema.devices)
    .set({ tokenHash: hash(token), pairedAt: new Date(), lastSeenAt: new Date(), name: name.trim().slice(0, 60) || "Android phone", pairingCode: null })
    .where(eq(schema.devices.id, row.id));
  const owner = (await db.query.users.findFirst({ where: eq(schema.users.id, row.userId) }))!;
  await logEvent(db, owner.id, owner.name, "device_paired", `${owner.name}'s Android phone (${name || "phone"}) is connected`);
  return { token, userName: owner.name };
}

/** Authenticates a request from the phone: `Authorization: Bearer <token>`. */
export async function deviceByToken(db: Db, authorization: string | null) {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new HttpError(401, "This phone is not connected. Open the Pause Button app and connect it.");
  const device = await db.query.devices.findFirst({ where: and(eq(schema.devices.tokenHash, hash(token)), isNotNull(schema.devices.pairedAt)) });
  if (!device) throw new HttpError(401, "This phone is no longer connected. Connect it again.");
  const user = (await db.query.users.findFirst({ where: eq(schema.users.id, device.userId) }))!;
  // Heard from: if the sync job had marked it quiet, it is syncing again.
  const [seen] = await db
    .update(schema.devices)
    .set({ lastSeenAt: new Date(), notSyncingSince: null })
    .where(eq(schema.devices.id, device.id))
    .returning();
  return { device: seen ?? device, user };
}

/**
 * A real message the phone saw. Same path as the simulated inbox.
 * deviceMessageId is the phone's own id for it (its Idempotency-Key): a
 * repeated post returns the first result and counts nothing twice.
 */
export async function deviceInbox(db: Db, device: Device, user: User, msg: SimInput, deviceMessageId?: string | null) {
  const row = await deliverMessage(db, user, msg, { deviceMessageId });
  if (!row.duplicate) {
    await db
      .update(schema.devices)
      .set({ lastMessageAt: new Date(), messagesSeen: sql`${schema.devices.messagesSeen} + 1` })
      .where(eq(schema.devices.id, device.id));
  }
  return row;
}

/**
 * What the person chose to have watched (Settings › Watch my messages). The
 * phone applies it itself, so a message from an app that is not watched, or
 * from a saved contact with "only unknown senders" on, never leaves the phone.
 */
export function watchSettings(user: User) {
  return { watchSms: user.watchSms, watchWhatsapp: user.watchWhatsapp, unknownOnly: user.unknownOnly };
}

/** "Disconnect this phone" on the phone itself: its token stops working, and the web app no longer lists it. */
export async function disconnectDevice(db: Db, device: Device, owner: User) {
  await db.delete(schema.devices).where(eq(schema.devices.id, device.id));
  await logEvent(db, owner.id, owner.name, "device_removed", `${owner.name}'s Android phone (${device.name}) disconnected itself`);
}

/**
 * The phone's report: whether notification access is on, how many messages
 * wait in its outbox, and (sync) that its 30-minute SyncWorker just ran.
 */
export async function setDeviceStatus(db: Db, device: Device, status: { listenerOn: boolean; waiting?: number; sync?: boolean }) {
  const [row] = await db
    .update(schema.devices)
    .set({
      listenerOn: status.listenerOn,
      ...(status.waiting !== undefined ? { waiting: status.waiting } : {}),
      ...(status.sync ? { lastSyncAt: new Date() } : {}),
    })
    .where(eq(schema.devices.id, device.id))
    .returning();
  return row ?? device;
}

/** A paired phone that has not reported for this long (two missed 30-minute syncs) is "not syncing". */
export const QUIET_AFTER_MINUTES = 60;

/**
 * The sync job's check on the phones: each paired phone that went quiet is
 * flagged once (notSyncingSince; deviceByToken clears it when the phone is
 * heard from again), and its household's log says so.
 */
export async function markQuietDevices(db: Db, now = new Date()) {
  const d = schema.devices;
  const cutoff = new Date(now.getTime() - QUIET_AFTER_MINUTES * 60_000);
  const quiet = await db
    .update(d)
    .set({ notSyncingSince: now })
    .where(and(isNotNull(d.pairedAt), isNull(d.notSyncingSince), or(lt(d.lastSeenAt, cutoff), and(isNull(d.lastSeenAt), lt(d.pairedAt, cutoff)))))
    .returning();
  for (const device of quiet) {
    const owner = await db.query.users.findFirst({ where: eq(schema.users.id, device.userId) });
    if (owner) await logEvent(db, owner.id, "Sync job", "device_quiet", `${owner.name}'s Android phone stopped syncing`);
  }
  return quiet;
}

export async function listDevices(db: Db, owner: User): Promise<DeviceView[]> {
  const rows = await db.query.devices.findMany({ where: eq(schema.devices.userId, owner.id), orderBy: asc(schema.devices.createdAt) });
  return rows.filter((d) => d.pairedAt || (d.pairingExpiresAt && d.pairingExpiresAt.getTime() > Date.now())).map(toDeviceView);
}

export async function removeDevice(db: Db, owner: User, id: string) {
  const [row] = await db
    .delete(schema.devices)
    .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, owner.id)))
    .returning();
  if (!row) throw new HttpError(404, "That phone was not found.");
  await logEvent(db, owner.id, owner.name, "device_removed", `${owner.name} disconnected an Android phone`);
}

/**
 * Digital Asset Links for phones still on the 0.2 app (a Trusted Web Activity
 * that opened the site in Chrome). The current app needs none. Fingerprints
 * come from `ANDROID_CERT_SHA256` (comma-separated); without it the list is empty.
 */
export function assetLinks() {
  const prints = (process.env.ANDROID_CERT_SHA256 ?? "")
    .split(",")
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  if (!prints.length) return [];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: prints },
    },
  ];
}
