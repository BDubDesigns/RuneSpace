import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Structural containment guard (finding #2 hardening): `server/admin-command-seams.ts`
 * is an INTERNAL admin module whose functions assume authorization was already
 * established (they take an explicit admin user id). Only the single production
 * forwarding module `server/admin-commands.ts` may import them. This filesystem
 * scan keeps that convention durable: any future production caller that starts
 * importing the raw seams bypassing `requireAdmin` fails this test.
 */
describe("admin-command-seams import containment", () => {
  const ALLOWED_IMPORTER = "server/admin-commands.ts";

  function sourceFilesUnder(root: string, out: string[] = []): string[] {
    const abs = join(process.cwd(), root);
    if (!statSync(abs, { throwIfNoEntry: false })) return out;
    for (const entry of readdirSync(abs)) {
      const full = join(abs, entry);
      const rel = join(root, entry);
      if (statSync(full).isDirectory()) {
        sourceFilesUnder(rel, out);
      } else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) {
        out.push(rel);
      }
    }
    return out;
  }

  function seamImportKinds(src: string, importer: string): string[] {
    const hits: string[] = [];
    const seamBasename = "admin-command-seams";
    // @/server/admin-command-seams
    const reg = /(?:from\s+|import\(\s*)(["'])(@\/server\/admin-command-seams)\1/g;
    let m: RegExpExecArray | null;
    while ((m = reg.exec(src))) if (m[2]) hits.push(m[2]);
    // Relative imports that resolve to the seams module within server/.
    if (importer.startsWith("server/") || importer.startsWith("app/")) {
      const relRe = new RegExp(
        `(?:from\\s+|import\\(\\s*)(["'])([^"']*\\/?)${seamBasename}["']`,
        "g",
      );
      let r: RegExpExecArray | null;
      while ((r = relRe.exec(src))) if (r[2]) hits.push(r[2]);
    }
    return hits;
  }

  it("no production module imports the raw seams except server/admin-commands.ts", () => {
    const violating: string[] = [];
    for (const root of ["server", "features", "app", "components"]) {
      for (const rel of sourceFilesUnder(root)) {
        if (rel === ALLOWED_IMPORTER) continue;
        const src = readFileSync(rel, "utf8");
        if (seamImportKinds(src, rel).length > 0) {
          violating.push(rel);
        }
      }
    }
    expect(violating).toEqual([]);
  });

  it("the ONE allowed production importer stays the requireAdmin forwarding module", () => {
    const src = readFileSync(ALLOWED_IMPORTER, "utf8");
    expect(seamImportKinds(src, ALLOWED_IMPORTER).length).toBeGreaterThan(0);
    // ... and it only forwards through requireAdmin-guarded wrappers.
    const body = readFileSync("server/admin-commands.ts", "utf8");
    const requireAdminRefs = (body.match(/requireAdmin\(/g) ?? []).length;
    expect(requireAdminRefs).toBeGreaterThan(0);
  });
});
