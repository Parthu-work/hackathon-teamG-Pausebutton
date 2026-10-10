import crypto from "node:crypto";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { secretFromEnv } from "./secrets";
import { HttpError } from "./session";

// Sign-in codes (A1). A random 4-digit code per request, kept only as an HMAC.
// It works once, for 5 minutes, and stops after 5 wrong tries. Asking again
// (Resend) retires the old code. Who delivers it is an OtpSender: the demo
// sender hands it back so the screen can show it once; an SMS provider comes later.

export const OTP_LENGTH = 4;
export const OTP_TTL_MINUTES = 5;
export const OTP_RESEND_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 5;

export const OTP_EXPIRED = "That code has expired. Tap Resend.";
export const OTP_LOCKED = "Too many tries. Ask for a new code.";
export const OTP_WRONG = "That code is not right. Please check it and try again.";
export const OTP_NONE = "Ask for a code first.";
export const OTP_FORMAT = "Please type the 4-digit code.";

const hashCode = (phone: string, code: string) =>
  crypto.createHmac("sha256", secretFromEnv("SESSION_SECRET", "pause-button-dev-secret")).update(`otp:${phone}:${code}`).digest("hex");

/** Delivers a code to a phone. shownCode: the demo sender hands the code back to be shown on screen once. */
export interface OtpSender {
  readonly name: "demo" | "sms";
  send(phone: string, code: string): Promise<{ shownCode?: string }>;
}

export class DemoOtpSender implements OtpSender {
  readonly name = "demo";
  async send(_phone: string, code: string) {
    return { shownCode: code };
  }
}

/** Placeholder for a real SMS provider (MSG91, Twilio, Firebase Auth): not wired up yet. */
export class SmsOtpSender implements OtpSender {
  readonly name = "sms";
  async send(): Promise<{ shownCode?: string }> {
    throw new HttpError(503, "Sign-in codes by SMS are not set up on this site yet.");
  }
}

/** OTP_PROVIDER=demo|sms (default demo). */
export function otpSender(env: Record<string, string | undefined> = process.env): OtpSender {
  return env.OTP_PROVIDER === "sms" ? new SmsOtpSender() : new DemoOtpSender();
}

/** Inside the resend cooldown (30 s after the last code for the number): a 429 with the seconds left. */
export async function assertResendOpen(db: Db, phone: string, now = new Date()) {
  const t = schema.otpCodes;
  const latest = await db.query.otpCodes.findFirst({
    where: and(eq(t.phone, phone), isNull(t.consumedAt)),
    orderBy: desc(t.createdAt),
  });
  if (!latest) return;
  const wait = Math.ceil((latest.createdAt.getTime() + OTP_RESEND_SECONDS * 1000 - now.getTime()) / 1000);
  if (wait > 0) throw new HttpError(429, `Please wait ${wait} second${wait === 1 ? "" : "s"} before asking for a new code.`, wait);
}

/**
 * A fresh code for a number. Inside the resend cooldown it is a 429 with the
 * seconds left; otherwise every older unused code for the number stops working.
 */
export async function issueCode(db: Db, phone: string, now = new Date()) {
  const t = schema.otpCodes;
  await assertResendOpen(db, phone, now);
  const code = String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);
  const row = await db.transaction(async (tx) => {
    await tx.update(t).set({ consumedAt: now }).where(and(eq(t.phone, phone), isNull(t.consumedAt)));
    const [inserted] = await tx.insert(t).values({ phone, codeHash: hashCode(phone, code), expiresAt, createdAt: now }).returning();
    return inserted;
  });
  return { id: row.id, code, expiresAt, resendAt: new Date(now.getTime() + OTP_RESEND_SECONDS * 1000) };
}

/** Records that the demo code was put on screen. It is never handed out again. */
export async function markShown(db: Db, id: string, now = new Date()) {
  await db.update(schema.otpCodes).set({ shownAt: now }).where(eq(schema.otpCodes.id, id));
}

/** A code that never reached the phone (the sender failed): it stops working and does not hold up the next request. */
export async function retireCode(db: Db, id: string, now = new Date()) {
  await db.update(schema.otpCodes).set({ consumedAt: now }).where(and(eq(schema.otpCodes.id, id), isNull(schema.otpCodes.consumedAt)));
}

/**
 * Checks a typed code against the newest unused code for the number. Every
 * try at a 4-digit code counts; the right code is used up atomically, so it
 * works exactly once, and any other code still open for the number goes with it.
 */
export async function verifyCode(db: Db, phone: string, code: string, now = new Date()) {
  const t = schema.otpCodes;
  const latest = await db.query.otpCodes.findFirst({
    where: and(eq(t.phone, phone), isNull(t.consumedAt)),
    orderBy: desc(t.createdAt),
  });
  if (!latest) throw new HttpError(400, OTP_NONE);
  if (latest.expiresAt.getTime() <= now.getTime()) throw new HttpError(400, OTP_EXPIRED);
  // A slip (three digits, a letter) tells a stranger nothing, so it is not a try.
  const typed = code.trim();
  if (typed.length !== OTP_LENGTH || /\D/.test(typed)) throw new HttpError(400, OTP_FORMAT);
  const [counted] = await db
    .update(t)
    .set({ attempts: sql`${t.attempts} + 1` })
    .where(and(eq(t.id, latest.id), isNull(t.consumedAt), lt(t.attempts, OTP_MAX_ATTEMPTS)))
    .returning();
  if (!counted) throw new HttpError(400, OTP_LOCKED);
  const given = Buffer.from(hashCode(phone, typed));
  const right = crypto.timingSafeEqual(given, Buffer.from(latest.codeHash));
  if (!right) throw new HttpError(400, counted.attempts >= OTP_MAX_ATTEMPTS ? OTP_LOCKED : OTP_WRONG);
  const [used] = await db
    .update(t)
    .set({ consumedAt: now })
    .where(and(eq(t.id, latest.id), isNull(t.consumedAt)))
    .returning();
  if (!used) throw new HttpError(400, OTP_NONE);
  await db.update(t).set({ consumedAt: now }).where(and(eq(t.phone, phone), isNull(t.consumedAt)));
}

/** Codes are useless a day later: the purge drops them. */
export async function sweepOtpCodes(db: Db, now = new Date()) {
  const rows = await db
    .delete(schema.otpCodes)
    .where(lt(schema.otpCodes.createdAt, new Date(now.getTime() - 24 * 3600_000)))
    .returning({ id: schema.otpCodes.id });
  return rows.length;
}
