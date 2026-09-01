import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";

/**
 * Deterministic Better Auth admin-session bootstrap for the admin E2E spec
 * (Issue #113, guardrail 2).
 *
 * We must NOT register a fresh user and then mutate `user.id` — the account and
 * session reference `user.id`, so that would orphan them. Instead we seed a
 * Better Auth user with a FIXED id (chosen to be on the server's
 * `RUNESPACE_ADMIN_USER_IDS` allowlist) plus its credential account with a
 * real Better Auth password hash. The browser spec then performs a genuine HTTP
 * sign-in against the running server with those seeded credentials, so Better
 * Auth itself issues and signs the session cookie. No hand-forged cookie and no
 * id mutation.
 *
 * The seed is deterministic and idempotent: seeding twice is a no-op.
 */

export const ADMIN_USER_ID = "00000000-0000-0000-0000-0000000000a1";
const ADMIN_EMAIL = `operator-${ADMIN_USER_ID}@example.com`;
const ADMIN_PASSWORD = "sup3r-secret-admin-password";

/**
 * Ensure the fixed admin user + credential account exist. Returns the
 * credentials the browser spec uses to sign in through the running server.
 */
export async function seedAdminOperator(): Promise<{
  adminUserId: string;
  email: string;
  password: string;
}> {
  const existing = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, ADMIN_USER_ID));
  if (!existing.length) {
    const passwordHash = await hashPassword(ADMIN_PASSWORD);
    await db.transaction(async (tx) => {
      await tx.insert(authSchema.user).values({
        id: ADMIN_USER_ID,
        name: "Operator Console",
        email: ADMIN_EMAIL,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await tx.insert(authSchema.account).values({
        id: `${ADMIN_USER_ID}-credential`,
        accountId: ADMIN_USER_ID,
        providerId: "credential",
        userId: ADMIN_USER_ID,
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  }
  return { adminUserId: ADMIN_USER_ID, email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
}
