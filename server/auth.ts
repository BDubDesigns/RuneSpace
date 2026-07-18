import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "@/db";
import { env } from "@/server/env";
import * as authSchema from "@/db/auth-schema";
import { authOptions } from "@/server/auth-options";

/**
 * Better Auth — the single source of truth for authentication identity and
 * sessions (user, session, account/provider, verification records).
 *
 * Per the issue and `docs/architecture.md`:
 * - Email/password authentication is enabled.
 * - The official Drizzle adapter backs persistence (provider "pg").
 * - Better Auth owns credential and session security; we never duplicate
 *   password or session tables elsewhere.
 * - RuneSpace ownership (player_accounts, characters) lives in separate domain
 *   tables and is resolved by `server/ownership.ts`, never by the auth tables.
 *
 * The schema tables are imported from the generated `db/auth-schema.ts` so the
 * adapter and Drizzle migrations share one definition.
 */
export const auth = betterAuth({
  ...authOptions,
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: false,
    schema: {
      user: authSchema.user,
      session: authSchema.session,
      account: authSchema.account,
      verification: authSchema.verification,
    },
  }),
});
