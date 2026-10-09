import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import type { EventView } from "@/lib/views";

/** Writes one line to the live event log (L2) and the hold timeline (I4). */
export async function logEvent(
  db: Db,
  householdId: string,
  actor: string,
  type: string,
  message: string,
  holdId: string | null = null,
) {
  await db.insert(schema.events).values({ householdId, actor, type, message, holdId });
}

export async function listEvents(db: Db, householdIds: string[], sinceId = 0): Promise<EventView[]> {
  const rows = sinceId
    ? await db.query.events.findMany({
        where: and(inArray(schema.events.householdId, householdIds), gt(schema.events.id, sinceId)),
        orderBy: asc(schema.events.id),
        limit: 200,
      })
    : (
        await db.query.events.findMany({
          where: inArray(schema.events.householdId, householdIds),
          orderBy: desc(schema.events.id),
          limit: 60,
        })
      ).reverse();
  return rows.map((e) => ({ id: e.id, actor: e.actor, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() }));
}

export async function holdTimeline(db: Db, holdId: string): Promise<EventView[]> {
  const rows = await db.query.events.findMany({ where: eq(schema.events.holdId, holdId), orderBy: asc(schema.events.id) });
  return rows.map((e) => ({ id: e.id, actor: e.actor, type: e.type, message: e.message, createdAt: e.createdAt.toISOString() }));
}
