import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { formatPhone } from "@/lib/phone";
import { readBody, route } from "@/lib/server/http";
import { otpSender, verifyCode } from "@/lib/server/otp";
import { rateLimit } from "@/lib/server/ratelimit";
import { HttpError, requireDemoSignIn, setSession } from "@/lib/server/session";

/** A1 step 2: the mobile number and the code from /api/auth/code. */
export const POST = route(async (req) => {
  if (otpSender().name === "demo") requireDemoSignIn();
  const db = await getDb();
  const body = await readBody(req, z.object({ phone: z.string(), code: z.string() }));
  const phone = formatPhone(body.phone);
  await rateLimit(db, req, "signIn", phone ?? undefined); // per IP, and per number tried
  if (!phone) throw new HttpError(400, "Please enter a 10-digit mobile number.");
  await verifyCode(db, phone, body.code);
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
  return { redirect: "/role", suggestedName: displayName(user.name, { full: true }) };
});
