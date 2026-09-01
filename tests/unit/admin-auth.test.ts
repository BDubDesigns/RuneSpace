import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Fast, DB-free coverage for the server-only admin allowlist (Issue #113).
 *
 * The allowlist is parsed from `RUNESPACE_ADMIN_USER_IDS` once at module load in
 * `server/env.ts`, so allowlist parsing is exercised by resetting the module
 * graph with stubbed environment values. The pure `isAdminUserId` check is then
 * asserted against the reloaded module. The authenticated negative `requireAdmin`
 * path (a logged-in non-admin user) belongs to the PostgreSQL integration suite
 * where a real Better Auth session exists.
 */

const REQUIRED_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  BETTER_AUTH_SECRET: "test-secret-1234567890123456",
};

function stubBasicEnv() {
  vi.stubEnv("NODE_ENV", REQUIRED_ENV.NODE_ENV);
  vi.stubEnv("DATABASE_URL", REQUIRED_ENV.DATABASE_URL);
  vi.stubEnv("BETTER_AUTH_SECRET", REQUIRED_ENV.BETTER_AUTH_SECRET);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("admin allowlist env parsing (RUNESPACE_ADMIN_USER_IDS)", () => {
  it("fails closed when the variable is absent", async () => {
    stubBasicEnv();
    vi.resetModules();
    const { adminUserIdAllowlist } = await import("@/server/env");
    expect(adminUserIdAllowlist).toEqual([]);
  });

  it("fails closed when the variable is empty or whitespace", async () => {
    stubBasicEnv();
    vi.stubEnv("RUNESPACE_ADMIN_USER_IDS", "   , ,  ");
    vi.resetModules();
    const { adminUserIdAllowlist } = await import("@/server/env");
    expect(adminUserIdAllowlist).toEqual([]);
  });

  it("parses a comma-separated allowlist and trims whitespace per entry", async () => {
    stubBasicEnv();
    vi.stubEnv("RUNESPACE_ADMIN_USER_IDS", " usr_alpha ,  usr_beta  ,usr_gamma ,");
    vi.resetModules();
    const env = await import("@/server/env");
    expect(env.adminUserIdAllowlist).toEqual(["usr_alpha", "usr_beta", "usr_gamma"]);
  });

  it("exposes the allowlist to admin-auth and rejects non-members", async () => {
    stubBasicEnv();
    vi.stubEnv("RUNESPACE_ADMIN_USER_IDS", "usr_alpha,usr_beta");
    vi.resetModules();
    const { isAdminUserId, AdminError } = await import("@/server/admin-auth");
    expect(isAdminUserId("usr_alpha")).toBe(true);
    expect(isAdminUserId("usr_beta")).toBe(true);
    expect(isAdminUserId("usr_gamma")).toBe(false);
    expect(isAdminUserId("")).toBe(false);
    expect(AdminError).toBeDefined();
  });

  it("no allowlist means no user is an admin", async () => {
    stubBasicEnv();
    vi.resetModules();
    const { isAdminUserId } = await import("@/server/admin-auth");
    expect(isAdminUserId("any-user-id")).toBe(false);
  });

  it("AdminError defaults to a 403 status", async () => {
    stubBasicEnv();
    vi.resetModules();
    const { AdminError } = await import("@/server/admin-auth");
    const err = new AdminError("Forbidden");
    expect(err.status).toBe(403);
    expect(err.message).toBe("Forbidden");
    expect(err.name).toBe("AdminError");
  });
});
