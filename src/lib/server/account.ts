import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { unlinkEverywhere } from "./people";
import { HttpError } from "./session";
import { forgetSightings } from "./sightings";

// Account deletion (W5, docs/retention.md). Works the same from either app,
// because one person can both be protected and protect someone else.

type User = typeof schema.users.$inferSelect;

/**
 * A payment on hold stays until it is decided: his own (so his family's Block
 * still reaches it), or one in a household this person protects. Expired holds
 * count: they still hold the money and can still be blocked.
 */
async function assertNoPausedPayment(db: Db, user: User) {
  const protecting = await db.query.links.findMany({ where: and(eq(schema.links.familyId, user.id), eq(schema.links.status, "linked")) });
  const households = [user.id, ...protecting.map((l) => l.protectedId)];
  const paused = await db.query.holds.findFirst({
    where: and(inArray(schema.holds.userId, households), eq(schema.holds.status, "pending")),
  });
  if (paused) {
    throw new HttpError(409, "A payment is on hold. It has to be decided before you can delete your account.");
  }
}

/**
 * Deletes the person and everything that is theirs, in one transaction:
 *  - their account, settings, phones (watcher and push), checks, holds,
 *    alerts, answers, advice and inbox (the foreign keys cascade);
 *  - their household's activity log;
 *  - links where they are the trusted person go back to "waiting";
 *  - their campaign sightings stay, but no longer lead back to them;
 *  - domains they reported stay on the blocklist without their name.
 * Not reachable: notifications already shown on family phones, and log lines
 * in other households that name them, which age out after 30 days.
 */
export async function deleteAccount(db: Db, user: User) {
  if (user.isDemo || user.demoKey) throw new HttpError(403, "Demo accounts are shared and cannot be deleted.");
  await assertNoPausedPayment(db, user);
  await db.transaction(async (tx) => {
    // Lock the person: a check or link arriving now waits, then fails on the missing account.
    const [locked] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, user.id)).for("update");
    if (!locked) return; // already deleted
    await assertNoPausedPayment(tx, user);
    await unlinkEverywhere(tx, user);
    await tx.delete(schema.events).where(eq(schema.events.householdId, user.id));
    await forgetSightings(tx, user.id);
    await tx.update(schema.reportedDomains).set({ reportedByName: "" }).where(eq(schema.reportedDomains.reportedById, user.id));
    await tx.delete(schema.users).where(eq(schema.users.id, user.id));
  });
}
