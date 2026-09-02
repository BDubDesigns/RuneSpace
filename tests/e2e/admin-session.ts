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
 * Ensure an arbitrary Better Auth user + credential account exist with a fixed
 * id. Deterministic and idempotent. Used by the admin bootstrap, the
 * authenticated non-admin denial proof, and the browser denial path.
 */
export async function seedAuthUser(input: {
  id: string;
  name: string;
  email: string;
  password: string;
}): Promise<{ userId: string; email: string; password: string }> {
  const existing = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, input.id));
  if (!existing.length) {
    const passwordHash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      await tx.insert(authSchema.user).values({
        id: input.id,
        name: input.name,
        email: input.email,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await tx.insert(authSchema.account).values({
        id: `${input.id}-credential`,
        accountId: input.id,
        providerId: "credential",
        userId: input.id,
        password: passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  }
  return { userId: input.id, email: input.email, password: input.password };
}

/**
 * Ensure the fixed admin user + credential account exist. Returns the
 * credentials the browser spec uses to sign in through the running server.
 */
export async function seedAdminOperator(): Promise<{
  adminUserId: string;
  email: string;
  password: string;
}> {
  const { userId, email, password } = await seedAuthUser({
    id: ADMIN_USER_ID,
    name: "Operator Console",
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  return { adminUserId: userId, email, password };
}

/**
 * A non-admin Better Auth user with a fixed id guaranteed NOT on the admin
 * allowlist. Used to prove an authenticated ordinary user is denied admin
 * access (403, never the console) and that admin identity cannot be forged.
 */
export const NON_ADMIN_USER_ID = "00000000-0000-0000-0000-0000000000ff";
const NON_ADMIN_EMAIL = `player-${NON_ADMIN_USER_ID}@example.com`;
const NON_ADMIN_PASSWORD = "sup3r-secret-player-password";

export function seedNonAdminUser(): Promise<{ userId: string; email: string; password: string }> {
  return seedAuthUser({
    id: NON_ADMIN_USER_ID,
    name: "Ordinary Player",
    email: NON_ADMIN_EMAIL,
    password: NON_ADMIN_PASSWORD,
  });
}
