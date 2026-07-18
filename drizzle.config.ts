import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * Migrations are generated against the schema in `db/schema.ts` and written to
 * `drizzle/`. The DATABASE_URL is read from the environment by drizzle-kit.
 */

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  verbose: true,
  strict: true,
});
