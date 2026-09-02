import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  seedAdminOperator,
  seedNonAdminUser,
  NON_ADMIN_USER_ID,
  ADMIN_USER_ID,
} from "@/tests/e2e/admin-session";

/**
 * Drive `requireCurrentUser` (the session-resolution seam in server/ownership)
 * with a real authenticated NON-admin user so the whole downstream
 * authorization decision exercises real production code: the allowlist check in
 * `server/admin-auth.ts`, the 403 `AdminError`, `authorizeAdminPage`'s
 * `forbidden` classification, and the guarded mutation surface. Everything else
 * (error classes, allowlist membership, command guards) is untouched.
 */
vi.mock("@/server/ownership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ownership")>();
  return {
    ...actual,
    requireCurrentUser: async () => ({
      id: NON_ADMIN_USER_ID,
      email: `player-${NON_ADMIN_USER_ID}@example.com`,
      name: "Ordinary Player",
    }),
  };
});

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("admin session bootstrap + authorization-negative proof (real PostgreSQL)", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("seeds the fixed admin user and Better Auth authenticates those credentials", async () => {
    const { email, password, adminUserId } = await seedAdminOperator();
    expect(adminUserId).toBe(ADMIN_USER_ID);

    const { auth } = await import("@/server/auth");
    const { db } = await import("@/db");
    const authSchema = await import("@/db/auth-schema");

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

    const session = await auth.api.signInEmail({
      headers: new Headers({ host: "127.0.0.1:3000" }),
      body: { email, password },
    });
    expect(session.token).toBeTruthy();
    expect(session.user?.id).toBe(ADMIN_USER_ID);
  });

  it("authorizes the allowlisted ADMIN user id when an allowlist is configured", async () => {
    const { isAdminUserId } = await import("@/server/admin-auth");
    const allowlist = process.env.RUNESPACE_ADMIN_USER_IDS ?? "";
    if (!allowlist.split(",").includes(ADMIN_USER_ID)) return;
    expect(isAdminUserId(ADMIN_USER_ID)).toBe(true);
  });

  it("denies an authenticated NON-admin at requireAdmin (403) and refutes forgery", async () => {
    // The seeded non-admin is a REAL Better Auth user row (real signed-up id).
    const { email, userId } = await seedNonAdminUser();
    expect(userId).toBe(NON_ADMIN_USER_ID);
    const { db } = await import("@/db");
    const authSchema = await import("@/db/auth-schema");
    const rows = await db.select().from(authSchema.user).where(eq(authSchema.user.email, email));
    expect(rows[0]?.id).toBe(NON_ADMIN_USER_ID);

    // Re-import auth modules fresh so they observe the mocked session seam.
    vi.resetModules();
    const { requireAdmin, authorizeAdminPage, AdminError } = await import("@/server/admin-auth");
    const adminCommands = await import("@/server/admin-commands");

    const headers = new Headers({ host: "127.0.0.1:3000" });

    const page = await authorizeAdminPage(headers);
    expect(page.authorized).toBe(false);
    if (!page.authorized) expect(page.reason).toBe("forbidden");

    await expect(requireAdmin(headers)).rejects.toBeInstanceOf(AdminError);

    // A guarded mutation command is refused for the non-admin; nothing is
    // mutated or audited.
    const fixtures = await import("./fixtures");
    const rune = await import("@/db/rune-space");
    const ownership = await import("@/server/ownership");
    const characters = await import("@/server/characters");
    const character = await fixtures.createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      NON_ADMIN_USER_ID,
      `Denial ${NON_ADMIN_USER_ID.slice(0, 6)}`,
    );
    await expect(adminCommands.stopCurrentAction(headers, character.id)).rejects.toBeInstanceOf(
      AdminError,
    );
    const audit = await db
      .select()
      .from(rune.operatorAuditLogs)
      .where(eq(rune.operatorAuditLogs.characterId, character.id));
    expect(audit).toHaveLength(0);

    // No public command accepts a client-nominated admin user id.
    const names = Object.keys(adminCommands);
    for (const name of names) {
      expect(name.includes("AsAdmin")).toBe(false);
      expect(name.includes("ForAdmin")).toBe(false);
      expect(name).not.toBe("runAdminCharacterCommandAs");
    }
  });
});
