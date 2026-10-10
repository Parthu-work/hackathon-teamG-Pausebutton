import crypto from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { HttpError } from "./session";

// Rate limits for the routes a stranger could hammer: checks and calls (each
// can reach the Anthropic API), the phone watcher's inbox, and sign-in.
// Counters live in Postgres (rate_limits), a fixed window per key, so every
// server instance shares them and no new service is needed.

type Rule = { limit: number; windowMs: number };
type Policy = { ip: Rule[]; subject: Rule[] };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Per caller IP and per signed-in person (or paired phone, or mobile number).
 * Sign-in has two: asking for a code (signInCode) and trying one (signIn)
 * count apart, so wrong tries never use up the right to ask for a new code,
 * and the code's own lock (5 wrong tries, otp.ts) is what a person meets
 * first. Per number, 10 tries in 10 minutes is two codes' worth; the daily
 * caps keep a stranger from guessing a 4-digit code by patience.
 */
export const POLICIES = {
  check: { ip: [{ limit: 30, windowMs: MINUTE }], subject: [{ limit: 10, windowMs: MINUTE }, { limit: 200, windowMs: DAY }] },
  call: { ip: [{ limit: 30, windowMs: MINUTE }], subject: [{ limit: 10, windowMs: MINUTE }, { limit: 100, windowMs: DAY }] },
  inbox: { ip: [{ limit: 120, windowMs: MINUTE }], subject: [{ limit: 30, windowMs: MINUTE }, { limit: 1000, windowMs: DAY }] },
  demoSignIn: { ip: [{ limit: 20, windowMs: 10 * MINUTE }], subject: [] },
  signInCode: { ip: [{ limit: 10, windowMs: 10 * MINUTE }], subject: [{ limit: 5, windowMs: 10 * MINUTE }, { limit: 20, windowMs: DAY }] },
  signIn: { ip: [{ limit: 10, windowMs: 10 * MINUTE }], subject: [{ limit: 10, windowMs: 10 * MINUTE }, { limit: 30, windowMs: DAY }] },
} satisfies Record<string, Policy>;

export type PolicyName = keyof typeof POLICIES;

export const TOO_MANY = "Too many tries in a short time. Please wait a minute and try again.";

/**
 * The caller's IP. On Vercel x-real-ip and x-forwarded-for are set by the
 * platform. Elsewhere they can be forged, so put the app behind a proxy that
 * overwrites them; the per-person limits still hold either way.
 */
export function callerIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// IPs are personal data: only a short hash of one is stored.
const hashIp = (ip: string) => crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);

let calls = 0;
const SWEEP_EVERY = 500;

/** Counts one call against a key; true while it is within the limit. */
async function hit(db: Db, key: string, rule: Rule, now: Date): Promise<{ ok: boolean; retryAfter: number }> {
  const t = schema.rateLimits;
  const fresh = sql`${t.windowStart} <= ${new Date(now.getTime() - rule.windowMs).toISOString()}::timestamptz`;
  const [row] = await db
    .insert(t)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: t.key,
      // Both read the row as it was: an expired window restarts at 1.
      set: {
        count: sql`case when ${fresh} then 1 else ${t.count} + 1 end`,
        windowStart: sql`case when ${fresh} then ${now.toISOString()}::timestamptz else ${t.windowStart} end`,
      },
    })
    .returning();
  const resetsAt = new Date(row.windowStart).getTime() + rule.windowMs;
  return { ok: row.count <= rule.limit, retryAfter: Math.max(1, Math.ceil((resetsAt - now.getTime()) / 1000)) };
}

/**
 * Throws a 429 with a plain-language message once a caller goes over any rule
 * of the policy. Call it before the work it protects (the AI call, a sign-in).
 */
export async function rateLimit(db: Db, req: Request, name: PolicyName, subject?: string, now = new Date()) {
  const policy: Policy = POLICIES[name];
  const keys: [string, Rule][] = [
    ...policy.ip.map((r): [string, Rule] => [`${name}:ip:${hashIp(callerIp(req))}:${r.windowMs}`, r]),
    ...(subject ? policy.subject.map((r): [string, Rule] => [`${name}:who:${subject}:${r.windowMs}`, r]) : []),
  ];
  if (++calls % SWEEP_EVERY === 0) await sweepRateLimits(db, now);
  for (const [key, rule] of keys) {
    const { ok, retryAfter } = await hit(db, key, rule, now);
    if (!ok) throw new HttpError(429, TOO_MANY, retryAfter);
  }
}

/** Drops counters whose window ended long ago (the longest window is a day). */
export async function sweepRateLimits(db: Db, now = new Date()) {
  await db.delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, new Date(now.getTime() - 2 * DAY)));
}
