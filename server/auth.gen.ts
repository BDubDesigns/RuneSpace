import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "../db";
import { authOptions } from "./auth-options";

/**
 * Generation-only entry point for the Better Auth CLI (`better-auth generate`).
 *
 * The CLI loader does not resolve the `@/` path alias, so this file uses
 * relative imports and omits the `schema` mapping (the CLI emits the canonical
 * default tables). The produced `db/auth-schema.ts` is then consumed by the
 * real runtime config in `server/auth.config.ts`.
 *
 * This module is NOT imported by the application.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const auth = betterAuth({
  ...authOptions,
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: false,
  }),
});
