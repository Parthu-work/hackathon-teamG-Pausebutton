import crypto from "node:crypto";
import { lt } from "drizzle-orm";
import { LOG_DAYS } from "@/lib/check/config";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { purgeSharedText } from "./checks";
import { HttpError } from "./session";

// The scheduled purge (docs/retention.md). An hourly job calls
// POST /api/cron/purge; every check also clears expired message text first
// (storeCheck), and the read gates hide text past 24 hours in between.

/** Deletes everything past its retention period. Returns how many rows each step touched. */
export async function purgeExpired(db: Db, now = new Date()) {
  const text = await purgeSharedText(db, now);
  const logCutoff = new Date(now.getTime() - LOG_DAYS * 24 * 3600_000);
  const events = await db.delete(schema.events).where(lt(schema.events.createdAt, logCutoff)).returning({ id: schema.events.id });
  const deliveries = await db
    .delete(schema.pushDeliveries)
    .where(lt(schema.pushDeliveries.createdAt, logCutoff))
    .returning({ id: schema.pushDeliveries.id });
  return { ...text, events: events.length, pushDeliveries: deliveries.length };
}

/**
 * The purge endpoint's lock: `Authorization: Bearer <CRON_SECRET>` (what
 * GitHub Actions sends, and what Vercel Cron sends on its own). Without
 * CRON_SECRET on the server the endpoint stays shut.
 */
export function requireCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, "The scheduled purge is not set up: set CRON_SECRET.");
  const given = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  const digest = (v: string) => crypto.createHash("sha256").update(v).digest();
  if (!crypto.timingSafeEqual(digest(given), digest(secret))) throw new HttpError(401, "Wrong or missing purge key.");
}
