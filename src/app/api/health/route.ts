import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { route } from "@/lib/server/http";

/** Liveness for the host's health check (Railway, Render, Fly): the server is up and the database answers. */
export const GET = route(async () => {
  const db = await getDb();
  await db.execute(sql`select 1`);
  return { ok: true };
});
