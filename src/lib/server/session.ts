import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

// Mock sign-in (A1 says "Demo sign-in only"). Each app keeps its own signed
// cookie, so Mr Rao's phone (/) and a family phone (/family) can both be open
// in one browser. The demo panel (/demo) shows several phones side by side:
// each frame sends its own signed token in the x-pb-rao or x-pb-family header,
// which wins over the shared cookie.

export type App = "rao" | "family" | "pending";
const COOKIE: Record<App, string> = { rao: "pb_rao", family: "pb_family", pending: "pb_pending" };

const secret = () => process.env.SESSION_SECRET ?? "pause-button-dev-secret";
const sign = (v: string) => crypto.createHmac("sha256", secret()).update(v).digest("base64url").slice(0, 22);

export async function setSession(app: App, userId: string) {
  const jar = await cookies();
  jar.set(COOKIE[app], sessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(app: App) {
  (await cookies()).delete(COOKIE[app]);
}

/** The signed value stored in a session cookie (or the demo panel's per-frame header). */
export function sessionToken(userId: string) {
  return `${userId}.${sign(userId)}`;
}

function verify(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const [id, mac] = raw.split(".");
  return id && mac && crypto.timingSafeEqual(Buffer.from(sign(id)), Buffer.from(mac.padEnd(22).slice(0, 22))) ? id : null;
}

export async function sessionUserId(app: App): Promise<string | null> {
  if (app !== "pending") {
    const fromFrame = verify((await headers()).get(app === "family" ? "x-pb-family" : "x-pb-rao"));
    if (fromFrame) return fromFrame;
  }
  return verify((await cookies()).get(COOKIE[app])?.value);
}

/** Either phone app: a family member or a protected person (the demo panel's frame header decides first). */
export async function requireAnyUser() {
  const h = await headers();
  const order: ("rao" | "family")[] = h.get("x-pb-rao") ? ["rao", "family"] : ["family", "rao"];
  let id: string | null = null;
  for (const app of order) {
    id = await sessionUserId(app);
    if (id) break;
  }
  if (!id) throw new HttpError(401, "Please sign in.");
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!user) throw new HttpError(401, "Please sign in.");
  return { db, user };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(app: "rao" | "family") {
  const id = await sessionUserId(app);
  if (!id) throw new HttpError(401, "Please sign in.");
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!user) throw new HttpError(401, "Please sign in.");
  return { db, user };
}
