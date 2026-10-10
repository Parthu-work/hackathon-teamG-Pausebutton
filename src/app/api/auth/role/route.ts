import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { roleBody } from "@/lib/server/schemas";
import { clearSession, HttpError, sessionUserId, setSession } from "@/lib/server/session";

/** A2 "Who is this phone for?" and "Your name" (required: the home screen greets by it). */
export const POST = route(async (req) => {
  const body = await readBody(req, roleBody);
  const id = await sessionUserId("pending");
  if (!id) throw new HttpError(401, "Please sign in first.");
  const db = await getDb();
  await db.update(schema.users).set({ role: body.role, name: body.name }).where(eq(schema.users.id, id));
  await clearSession("pending");
  if (body.role === "protected") {
    await setSession("rao", id);
    return { redirect: "/setup" };
  }
  await setSession("family", id);
  return { redirect: "/family/join" };
});
