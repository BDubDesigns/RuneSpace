import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { env } from "@/server/env";

/**
 * Narrowly scoped PostgreSQL connection pool and Drizzle instance.
 *
 * This is the ONLY place that owns the database pool. Domain logic and feature
 * code must not construct their own pools; they receive a `Database` handle via
 * the server orchestration layer so persistence stays behind a clear boundary.
 *
 * No gameplay tables exist yet. `schema` currently holds only the migration
 * bookkeeping Drizzle needs; real game tables arrive in later issues.
 */

const globalForDb = globalThis as unknown as {
  __runespacePool?: Pool;
};

const pool: Pool = globalForDb.__runespacePool ?? new Pool({ connectionString: env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__runespacePool = pool;
}

export const db = drizzle(pool, { schema });

export type Database = typeof db;
