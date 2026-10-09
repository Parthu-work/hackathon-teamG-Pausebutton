import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { familyActivity } from "@/lib/server/state";

export const GET = route(async () => {
  const { db, user } = await requireUser("family");
  const link = await db.query.links.findFirst({ where: and(eq(schema.links.familyId, user.id), eq(schema.links.status, "linked")) });
  return link ? familyActivity(db, link.protectedId) : [];
});
