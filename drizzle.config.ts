import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * Migrations are generated against the schema in `db/schema.ts` and written to
 * `drizzle/`. The PostgreSQL connection string is read from `DATABASE_URL`
 * (validated at app start by `server/env.ts`). For local runs, `.env` is
 * loaded so `pnpm drizzle-kit migrate` works without extra flags.
 */

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
