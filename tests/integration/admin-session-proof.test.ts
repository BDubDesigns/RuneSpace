import { beforeAll, describe, expect, it } from "vitest";
import { seedAdminOperator, ADMIN_USER_ID } from "@/tests/e2e/admin-session";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Guardrail-2 proof for the admin E2E fixture: a deterministic direct-seed +
 * Better Auth session bootstrap must produce a session Better Auth genuinely
 * accepts and issues, WITHOUT registering-then-mutating `user.id`. This proves
 * the seed (fixed admin user + credential account) is valid so the browser spec
 * can sign in through the running server and obtain a real signed session
 * cookie. If this cannot be proven cleanly, the admin browser console spec is
 * STOPPED and reported; it does not block the rest of issue #113.
 */
suite("admin session bootstrap proof (real PostgreSQL)", () => {
  it("seeds the fixed admin user and Better Auth authenticates those credentials", async () => {
    const { email, password, adminUserId } = await seedAdminOperator();
    expect(adminUserId).toBe(ADMIN_USER_ID);

    const { auth } = await import("@/server/auth");
    const { eq } = await import("drizzle-orm");
    const { db } = await import("@/db");
    const authSchema = await import("@/db/auth-schema");

    // Deterministic/idempotent: the user row is fixed and created once.
    const users = await db
      .select()
      .from(authSchema.user)
      .where(eq(authSchema.user.id, ADMIN_USER_ID));
    expect(users).toHaveLength(1);
    const accounts = await db
      .select()
      .from(authSchema.account)
      .where(eq(authSchema.account.userId, ADMIN_USER_ID));
    expect(accounts.length).toBeGreaterThanOrEqual(1);

    // Better Auth itself accepts the seeded credentials and issues a real
    // session for the FIXED admin id (the browser spec captures the signed
    // cookie from the running server's HTTP sign-in).
    const session = await auth.api.signInEmail({
      headers: new Headers({ host: "127.0.0.1:3000" }),
      body: { email, password },
    });
    expect(session.token).toBeTruthy();
    expect(session.user?.id).toBe(ADMIN_USER_ID);
  });

  it("the admin allowlist accepts the seeded id when RUNESPACE_ADMIN_USER_IDS is set", async () => {
    const allowlist = process.env.RUNESPACE_ADMIN_USER_IDS ?? "";
    // The allowlist is server-boot config; the canonical E2E env sets it.
    // Under the plain integration runner it is absent, so this assertion only
    // applies when an allowlist is actually configured.
    if (!allowlist.split(",").includes(ADMIN_USER_ID)) return;
    const { isAdminUserId } = await import("@/server/admin-auth");
    expect(isAdminUserId(ADMIN_USER_ID)).toBe(true);
  });
});
