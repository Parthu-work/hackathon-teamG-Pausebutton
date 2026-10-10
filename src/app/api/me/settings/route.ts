import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { logEvent } from "@/lib/server/events";
import { holdMinutesField } from "@/lib/server/schemas";
import { requireUser } from "@/lib/server/session";

export const PATCH = route(async (req) => {
  const { db, user } = await requireUser("rao");
  const body = await readBody(
    req,
    z.object({
      textSize: z.enum(["A", "A+", "A++"]).optional(),
      language: z.enum(["en", "hi", "te"]).optional(),
      watchSms: z.boolean().optional(),
      watchWhatsapp: z.boolean().optional(),
      unknownOnly: z.boolean().optional(),
      autoTellFamily: z.boolean().optional(),
      alertNotify: z.boolean().optional(),
      holdMinutes: holdMinutesField.optional(),
    }),
  );
  await db.update(schema.users).set(body).where(eq(schema.users.id, user.id));
  // Applies to the next paused payment; one already running keeps its time.
  if (body.holdMinutes && body.holdMinutes !== user.holdMinutes) {
    await logEvent(db, user.id, user.name, "hold_minutes", `${user.name} set the payment hold time to ${body.holdMinutes} minutes`);
  }
});
