import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";

/**
 * Liveness for the host's health check (Railway, Render, Fly): the server is up
 * and the database answers. A failure names the missing setting (e.g. "Set
 * DATABASE_URL …"), never a secret's value.
 */
export async function GET() {
  await connection();
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error && error.message.startsWith("Set ") ? error.message : "The database did not answer.";
    return Response.json({ ok: false, error: message }, { status: 503 });
  }
}
