import crypto from "node:crypto";
import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { DeviceView } from "@/lib/views";
import { logEvent } from "./events";
import { HttpError } from "./session";
import { deliverMessage, type SimInput } from "./sim";

// The Android app's message watcher (screens M1–M4). The web app shows a
// pairing code; the phone exchanges it for a token it keeps for good, then
// posts every incoming SMS / WhatsApp notification to /api/device/inbox,
// which runs the same check as a pasted message.

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
  };
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
  await db.update(schema.devices).set({ lastSeenAt: new Date() }).where(eq(schema.devices.id, device.id));
  return { device, user };
}

/** A real message the phone saw. Same path as the simulated inbox. */
export async function deviceInbox(db: Db, device: Device, user: User, msg: SimInput) {
  const row = await deliverMessage(db, user, msg);
  await db
    .update(schema.devices)
    .set({ lastMessageAt: new Date(), messagesSeen: device.messagesSeen + 1 })
    .where(eq(schema.devices.id, device.id));
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

export async function setDeviceStatus(db: Db, device: Device, status: { listenerOn: boolean }) {
  await db.update(schema.devices).set({ listenerOn: status.listenerOn }).where(eq(schema.devices.id, device.id));
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
 * Digital Asset Links: tells Android that the app may open this site full
 * screen (no browser bar). Fingerprints come from the signing keys
 * (`ANDROID_CERT_SHA256`, comma-separated); without them the list is empty
 * and the app still works, just with Chrome's bar visible.
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
