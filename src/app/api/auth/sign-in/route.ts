import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { readBody, route } from "@/lib/server/http";
import { HttpError, setSession } from "@/lib/server/session";

const DEMO_CODE = "1234";

/** Keeps the last 10 digits and formats them like "+91 98765 43210". */
function formatPhone(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) throw new HttpError(400, "Please enter a 10-digit mobile number.");
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** A1: mobile number + the demo code. No real SMS is sent. */
export const POST = route(async (req) => {
  const body = await readBody(req, z.object({ phone: z.string(), code: z.string() }));
  if (body.code.trim() !== DEMO_CODE) throw new HttpError(400, "That code is not right. The demo code is 1234.");
  const phone = formatPhone(body.phone);
  const db = await getDb();
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
