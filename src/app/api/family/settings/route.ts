import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { logEvent } from "@/lib/server/events";
import { assertLinked } from "@/lib/server/holds";
import { holdMinutesField } from "@/lib/server/schemas";
import { requireUser } from "@/lib/server/session";

export const PATCH = route(async (req) => {
  const { db, user } = await requireUser("family");
  const body = await readBody(
    req,
    z.object({
      alertNotify: z.boolean().optional(),
      alertSound: z.boolean().optional(),
      alertVibrate: z.boolean().optional(),
      alertsReady: z.boolean().optional(),
      /** Payment hold time for one person this member protects. */
      hold: z.object({ protectedId: z.string(), minutes: holdMinutesField }).optional(),
    }),
  );
  const { hold, ...own } = body;
  if (hold) {
    await assertLinked(db, user, hold.protectedId);
    const [owner] = await db.update(schema.users).set({ holdMinutes: hold.minutes }).where(eq(schema.users.id, hold.protectedId)).returning();
    await logEvent(db, owner.id, user.name, "hold_minutes", `${user.name} set ${owner.name}'s payment hold time to ${hold.minutes} minutes`);
  }
  if (Object.keys(own).length) await db.update(schema.users).set(own).where(eq(schema.users.id, user.id));
});
