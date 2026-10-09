import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { clearSession, HttpError, sessionUserId, setSession } from "@/lib/server/session";

/** A2 "Who is this phone for?" */
export const POST = route(async (req) => {
  const body = await readBody(
    req,
    z.object({ role: z.enum(["protected", "family"]), name: z.string().trim().max(40).optional() }),
  );
  const id = await sessionUserId("pending");
  if (!id) throw new HttpError(401, "Please sign in first.");
  const db = await getDb();
  await db
    .update(schema.users)
    .set({ role: body.role, ...(body.name ? { name: body.name } : {}) })
    .where(eq(schema.users.id, id));
  await clearSession("pending");
  if (body.role === "protected") {
    await setSession("rao", id);
    return { redirect: "/setup" };
  }
  await setSession("family", id);
  return { redirect: "/family/join" };
});
