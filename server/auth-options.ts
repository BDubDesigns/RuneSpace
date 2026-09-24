import type { BetterAuthOptions } from "better-auth";
import { username } from "better-auth/plugins/username";
import { env } from "../server/env";
import {
  PLAYER_NAME_MAX,
  normalizePlayerNameDisplay,
  playerNameKey,
  validatePlayerName,
} from "../game/domain/player-name";

/**
 * Shared Better Auth options. Kept free of the database adapter so it can be
 * composed by both the generation config (relative imports, no DB) and the
 * runtime config (`@/` aliases + Drizzle schema). One place owns the
 * email/password policy, the host boundary, and every schema-shaping plugin,
 * so `db/auth-schema.ts` generated from `server/auth.gen.ts` always matches
 * what `server/auth.ts` runs.
 *
 * Uses Better Auth's dynamic baseURL with an explicit allowed-hosts boundary.
 * Relying on request-derived origins or a single static URL is neither safe nor
 * workable across production + PR previews.
 *
 * Runtime-only behavior that does not shape the schema — verification mail,
 * Turnstile, and the signup/resend abuse guards — is composed in
 * `server/auth.ts`.
 */
export const authOptions = {
  baseURL: {
    allowedHosts: [
      "runespace.qcfailed.com",
      "pr-*.runespace.qcfailed.com",
      "localhost:*",
      "127.0.0.1:*",
    ],
    protocol: "auto",
    // No fallback: unknown hosts must fail closed.
  },
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    // Issue #221: an account must verify its email before it can sign in or
    // reserve characters. Sign-up therefore creates no session.
    requireEmailVerification: true,
    minPasswordLength: 8,
  },
  // Player names are for display, never a second sign-in identifier.
  disabledPaths: ["/sign-in/username"],
  plugins: [
    /**
     * Official Username plugin as the Player-name store (issue #221):
     * `username` is the globally unique comparison key and `displayUsername`
     * the preserved presentation. Both normalizers and validators are the
     * RuneSpace Player-name rules, applied after normalization; the
     * plugin's own ASCII validator and UTF-16 length bounds are replaced
     * (the domain validator counts code points).
     */
    username({
      minUsernameLength: 1,
      maxUsernameLength: PLAYER_NAME_MAX * 4,
      usernameNormalization: playerNameKey,
      displayUsernameNormalization: normalizePlayerNameDisplay,
      usernameValidator: (key) => validatePlayerName(key).ok,
      displayUsernameValidator: (display) => validatePlayerName(display).ok,
      validationOrder: { username: "post-normalization", displayUsername: "post-normalization" },
    }),
  ],
  // The local production E2E runners (canonical and focused) run the production
  // server over plain HTTP. Better Auth's default `protocol: "auto"` +
  // production NODE_ENV sets Secure cookies that Chromium discards. This
  // env-controlled override allows those runners to disable Secure cookies
  // EXCLUSIVELY for the E2E browser session, never for preview or production
  // deployments.
  advanced: {
    useSecureCookies: process.env.RUNESPACE_E2E_CANONICAL_HTTP === "true" ? false : undefined,
  },
} satisfies BetterAuthOptions;
