import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { isDeployment } from "@/lib/server/secrets";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

// One database per server process. Without DATABASE_URL the app runs an
// embedded Postgres (PGlite) in .data/, so `pnpm dev` needs no setup.
// With DATABASE_URL (Neon or Railway Postgres in production) migrations run in the deploy step
// (`pnpm db:migrate`), not here.
const g = globalThis as unknown as { __pbDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  g.__pbDb ??= init().catch((error) => {
    g.__pbDb = undefined;
    throw error;
  });
  return g.__pbDb;
}

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  let db: Db;
  if (!url && isDeployment()) {
    throw new Error("Set DATABASE_URL (Postgres) for deployments. The embedded database only works on a local machine.");
  }
  if (url) {
    db = drizzlePg(new Pool({ connectionString: url, max: 5 }), { schema }) as unknown as Db;
  } else {
    const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
    if (dir !== "memory") fs.mkdirSync(dir, { recursive: true });
    const client = dir === "memory" ? new PGlite() : new PGlite(dir);
    const local = drizzlePglite(client, { schema });
    await migratePglite(local, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    db = local as unknown as Db;
  }
  const { ensureDemoHousehold } = await import("@/lib/server/demo");
  await ensureDemoHousehold(db);
  return db;
}
