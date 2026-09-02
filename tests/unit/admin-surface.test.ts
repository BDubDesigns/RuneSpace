import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #113 regression guard (correction finding #1/#8): the PRODUCTION admin
 * command surface must be safe-by-construction through `requireAdmin`. It must
 * never export a raw admin-seam name (`*AsAdmin`, `*ForAdmin`) or the bypass
 * runner `runAdminCharacterCommandAs`, because a future server caller could
 * otherwise invoke a privileged command on an arbitrary admin-user id while
 * skipping header authorization.
 *
 * The raw seams live in the INTERNAL `server/admin-command-seams.ts` module and
 * are tested directly against a real database; this unit guard keeps them out
 * of the production surface.
 *
 * Importing `@/server/admin-commands` pulls `server/env.ts`, which parses the
 * environment at module load, so we stub the required vars and reset the module
 * graph (mirroring `tests/unit/admin-auth.test.ts`) before dynamic imports.
 */

const REQUIRED_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  BETTER_AUTH_SECRET: "test-secret-1234567890123456",
};

function stubRequiredEnv() {
  vi.stubEnv("NODE_ENV", REQUIRED_ENV.NODE_ENV);
  vi.stubEnv("DATABASE_URL", REQUIRED_ENV.DATABASE_URL);
  vi.stubEnv("BETTER_AUTH_SECRET", REQUIRED_ENV.BETTER_AUTH_SECRET);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("admin production command surface (requireAdmin-only)", () => {
  it("exports no raw bypass seam names", async () => {
    stubRequiredEnv();
    vi.resetModules();
    const mod = (await import("@/server/admin-commands")) as Record<string, unknown>;
    const exportedNames = Object.keys(mod).filter((name) => name !== "default");
    const bypassNames = exportedNames.filter(
      (name) =>
        name.includes("AsAdmin") ||
        name.includes("ForAdmin") ||
        name === "runAdminCharacterCommandAs",
    );
    expect(bypassNames).toEqual([]);
  });

  it("exposes only the requireAdmin-guarded public commands", async () => {
    stubRequiredEnv();
    vi.resetModules();
    const mod = (await import("@/server/admin-commands")) as Record<string, unknown>;
    const exportedNames = Object.keys(mod).filter((name) => name !== "default");
    for (const expected of [
      "stopCurrentAction",
      "teleportCharacter",
      "removeCarriedStackQuantity",
      "removeCargoStackQuantity",
      "forceUnequipItem",
      "deleteUniqueItem",
      "addItem",
      "resetMissionChain",
      "resetAllMissions",
      "setSkillTotalXp",
      "AdminCommandError",
    ]) {
      expect(exportedNames, `missing public entrypoint ${expected}`).toContain(expected);
    }
  });

  it("the public admin-character module exports only the requireAdmin wrapper", async () => {
    stubRequiredEnv();
    vi.resetModules();
    const mod = (await import("@/server/admin-character")) as Record<string, unknown>;
    const exportedNames = Object.keys(mod).filter((name) => name !== "default");
    expect(exportedNames.includes("runAdminCharacterCommandAs")).toBe(false);
    expect(exportedNames).toContain("runAdminCharacterCommand");
  });
});
