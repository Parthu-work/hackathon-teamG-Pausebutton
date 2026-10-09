import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
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
    }),
  );
  await db.update(schema.users).set(body).where(eq(schema.users.id, user.id));
});
