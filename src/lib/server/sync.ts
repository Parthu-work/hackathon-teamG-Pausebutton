import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { SHARE_TEXT_HOURS } from "@/lib/check/config";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { SyncHealthView, SyncRunView } from "@/lib/views";
import { alertPush, failureCode } from "./checks";
import { markQuietDevices } from "./devices";
import { log } from "./log";
import { linkedFamily } from "./people";
import { pushEnabled, pushToUsers, SILENT_AFTER_MS } from "./push";
import { checkAgain } from "./sim";

// The 30-minute sync job (POST /api/cron/sync, called by
// .github/workflows/sync.yml). The live path stays first: the phone posts a
// message at once, screens poll every 2 seconds, push reaches closed apps.
// This is the safety net under it. Each run:
//  1. checks again a watcher message whose check failed (or stopped half-way
//     through), while its text is kept and up to MAX_ATTEMPTS tries. Family
//     is alerted only if it now turns out to be a SCAM (storeCheck);
//  2. pushes a scam alert once more when no family phone confirmed it and
//     nobody opened it;
//  3. flags a paired phone that has not reported for an hour (the family
//     phone says "has not synced for over an hour");
//  4. records the run (sync_runs) for /api/ops/sync-health.
// It is safe to call twice at once: a run holds a lease (its unfinished
// sync_runs row), and a second caller finds it and stops. The lease is taken
// under a transaction-scoped advisory lock, so two claims cannot both see "no
// run"; a run still unfinished after LEASE_MINUTES crashed, and the next one
// takes over.

export const SYNC_INTERVAL_MINUTES = 30;
/** The sync job stops trying a message after this many checks. */
export const MAX_ATTEMPTS = 3;
const LEASE_MINUTES = 15;
/** A message still "being checked" this long after its last try was cut off (the server stopped). */
const STUCK_MINUTES = 10;
/** No finished run for this long: the schedule is not calling us. */
const OVERDUE_MINUTES = 45;
/** Each check can wait on the AI: a run stops starting new ones after this long, well inside the lease and the caller's timeout; the rest wait for the next run. */
const RECHECK_BUDGET_MS = 90_000;
const BATCH = 100;
/** The advisory lock that makes claiming a run one at a time ("SYNC"). */
const SYNC_LOCK = 0x53594e43;

type SyncRun = typeof schema.syncRuns.$inferSelect;
export type SyncResult = { skipped: true } | ({ skipped: false } & SyncRunView);

export async function runSync(db: Db, now = new Date()): Promise<SyncResult> {
  const run = await claimRun(db, now);
  if (!run) {
    log.info("sync_skipped", { reason: "running" });
    return { skipped: true };
  }
  const started = Date.now();
  const counts = { rechecked: 0, recheckFailed: 0, repushed: 0, quietDevices: 0 };
  // One step failing does not stop the others; the run records which failed.
  const errors: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      errors.push(`${name}:${failureCode(error)}`);
      log.error("sync_step_failed", { runId: run.id, step: name, error: failureCode(error) });
    }
  };
  await step("recheck", async () => {
    Object.assign(counts, await recheckMessages(db, now));
  });
  await step("repush", async () => {
    counts.repushed = await repushUnconfirmed(db, now);
  });
  await step("devices", async () => {
    counts.quietDevices = (await markQuietDevices(db, now)).length;
  });

  const [done] = await db
    .update(schema.syncRuns)
    .set({ ...counts, finishedAt: new Date(), error: errors.join(" ") || null })
    .where(eq(schema.syncRuns.id, run.id))
    .returning();
  log.info("sync_run", { runId: run.id, ...counts, error: done.error, ms: Date.now() - started });
  return { skipped: false, ...toRunView(done) };
}

/** Takes the lease: the new run's row, or null when another run holds it. */
async function claimRun(db: Db, now: Date): Promise<SyncRun | null> {
  const r = schema.syncRuns;
  return db.transaction(async (tx) => {
    const lock = (await tx.execute(sql`select pg_try_advisory_xact_lock(${SYNC_LOCK}::bigint) as locked`)) as unknown as { rows: { locked: boolean }[] };
    if (!lock.rows[0]?.locked) return null; // another caller is claiming right now
    await tx
      .update(r)
      .set({ finishedAt: now, error: "abandoned" })
      .where(and(isNull(r.finishedAt), lt(r.startedAt, new Date(now.getTime() - LEASE_MINUTES * 60_000))));
    if (await tx.query.syncRuns.findFirst({ where: isNull(r.finishedAt) })) return null;
    const [run] = await tx.insert(r).values({ startedAt: now }).returning();
    return run;
  });
}

/** Step 1: messages whose check failed, or stopped half-way, checked again through the same exactly-once path. */
async function recheckMessages(db: Db, now: Date) {
  const m = schema.simMessages;
  const stuck = new Date(now.getTime() - STUCK_MINUTES * 60_000);
  const rows = await db.query.simMessages.findMany({
    where: and(
      isNull(m.checkId),
      isNotNull(m.text),
      lt(m.attempts, MAX_ATTEMPTS),
      gt(m.createdAt, new Date(now.getTime() - SHARE_TEXT_HOURS * 3600_000)),
      or(eq(m.status, "failed"), and(eq(m.status, "received"), or(lt(m.lastTriedAt, stuck), and(isNull(m.lastTriedAt), lt(m.createdAt, stuck))))),
    ),
    orderBy: asc(m.createdAt),
    limit: BATCH,
  });
  const owners = rows.length ? await db.query.users.findMany({ where: inArray(schema.users.id, [...new Set(rows.map((r) => r.userId))]) }) : [];
  let rechecked = 0;
  let recheckFailed = 0;
  const until = Date.now() + RECHECK_BUDGET_MS;
  for (const row of rows) {
    if (Date.now() > until) break;
    const owner = owners.find((u) => u.id === row.userId);
    if (!owner) continue;
    try {
      const r = await checkAgain(db, owner, row, MAX_ATTEMPTS);
      if (r.status === "failed") recheckFailed++;
      else if (r.status === "checked" && !r.duplicate) rechecked++;
      log.info("sync_recheck", { simMessageId: row.id, checkId: r.checkId, status: r.status, attempts: row.attempts + 1 });
    } catch (error) {
      recheckFailed++;
      log.error("sync_recheck", { simMessageId: row.id, status: "error", error: failureCode(error) });
    }
  }
  return { rechecked, recheckFailed };
}

/**
 * Step 2: a scam alert (urgent or heads-up) from the last 24 hours, at least
 * SILENT_AFTER_MS old, that no phone confirmed (no receipt for its push) and
 * the family app has not picked up, opened or handled: pushed once more, under
 * its own key so the push log tells the two apart.
 */
async function repushUnconfirmed(db: Db, now: Date) {
  if (!pushEnabled()) return 0;
  const a = schema.alerts;
  const d = schema.pushDeliveries;
  const candidates = await db.query.alerts.findMany({
    where: and(
      inArray(a.kind, ["urgent", "headsup"]),
      isNull(a.repushedAt),
      isNull(a.deliveredAt),
      isNull(a.openedAt),
      isNull(a.handledAt),
      gt(a.createdAt, new Date(now.getTime() - 24 * 3600_000)),
      lt(a.createdAt, new Date(now.getTime() - SILENT_AFTER_MS)),
    ),
    orderBy: asc(a.createdAt),
    limit: BATCH,
  });
  if (!candidates.length) return 0;
  const confirmed = await db.query.pushDeliveries.findMany({
    where: and(inArray(d.key, candidates.map((c) => `alert:${c.id}`)), or(isNotNull(d.receivedAt), isNotNull(d.shownAt))),
  });
  let repushed = 0;
  for (const alert of candidates.filter((c) => !confirmed.some((x) => x.key === `alert:${c.id}`))) {
    // Once only: the alert is marked before the push goes out.
    const [claimed] = await db.update(a).set({ repushedAt: now }).where(and(eq(a.id, alert.id), isNull(a.repushedAt))).returning();
    if (!claimed) continue;
    const check = await db.query.checks.findFirst({ where: eq(schema.checks.id, alert.checkId) });
    const owner = check && (await db.query.users.findFirst({ where: eq(schema.users.id, check.userId) }));
    const link = owner && (await linkedFamily(db, owner.id)).find((f) => f.familyId === alert.recipientId);
    if (!check || !owner || !link) continue; // no longer linked: nothing to tell them
    const r = await pushToUsers(db, [alert.recipientId], alertPush(owner, check, claimed, link.relation), {
      key: `alert:${alert.id}:repush`,
      alertId: alert.id,
      checkId: check.id,
    });
    if (r.sent) repushed++;
    log.info("sync_repush", { alertId: alert.id, checkId: check.id, sent: r.sent, failed: r.failed, gone: r.gone });
  }
  return repushed;
}

/** GET /api/ops/sync-health: the last 20 runs, and whether a run is overdue. */
export async function syncHealth(db: Db, now = new Date()): Promise<SyncHealthView> {
  const r = schema.syncRuns;
  const rows = await db.query.syncRuns.findMany({ orderBy: desc(r.startedAt), limit: 20 });
  const recent = await db.query.syncRuns.findFirst({
    where: and(gt(r.finishedAt, new Date(now.getTime() - OVERDUE_MINUTES * 60_000)), or(isNull(r.error), ne(r.error, "abandoned"))),
  });
  const runs = rows.map(toRunView);
  return { lastRun: runs[0] ?? null, runs, overdue: !recent, intervalMinutes: SYNC_INTERVAL_MINUTES };
}

function toRunView(r: SyncRun): SyncRunView {
  return {
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    rechecked: r.rechecked,
    recheckFailed: r.recheckFailed,
    repushed: r.repushed,
    quietDevices: r.quietDevices,
    error: r.error,
  };
}
