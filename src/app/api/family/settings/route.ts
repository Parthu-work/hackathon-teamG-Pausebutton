import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
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
    }),
  );
  await db.update(schema.users).set(body).where(eq(schema.users.id, user.id));
});
