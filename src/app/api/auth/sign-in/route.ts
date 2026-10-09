import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { readBody, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { HttpError, requireDemoSignIn, setSession } from "@/lib/server/session";

const DEMO_CODE = "1234";

/** A1: mobile number + the demo code. No real SMS is sent, so it is demo sign-in too (DEMO_SIGNIN). */
export const POST = route(async (req) => {
  requireDemoSignIn();
  const db = await getDb();
  const body = await readBody(req, z.object({ phone: z.string(), code: z.string() }));
  const phone = formatPhone(body.phone);
  await rateLimit(db, req, "signIn", phone ?? undefined); // per IP, and per number tried
  if (body.code.trim() !== DEMO_CODE) throw new HttpError(400, "That code is not right. The demo code is 1234.");
  if (!phone) throw new HttpError(400, "Please enter a 10-digit mobile number.");
  let user = await db.query.users.findFirst({ where: eq(schema.users.phone, phone) });
  if (!user) {
    const invited = await db.query.links.findFirst({ where: eq(schema.links.phone, phone) });
    [user] = await db.insert(schema.users).values({ name: invited?.name ?? "Guest", phone }).returning();
  }
  if (user.role === "protected") {
    await setSession("rao", user.id);
    return { redirect: "/" };
  }
  if (user.role === "family") {
    await setSession("family", user.id);
    return { redirect: "/family" };
  }
  await setSession("pending", user.id);
  return { redirect: "/role", needsName: user.name === "Guest" };
});
