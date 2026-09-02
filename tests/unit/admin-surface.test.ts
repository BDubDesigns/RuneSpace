import { describe, expect, it } from "vitest";

/**
 * Issue #113 regression guard (correction D-passthrough finding #1/#8): the
 * PRODUCTION admin command surface must be safe-by-construction through
 * `requireAdmin`. It must never export a raw admin-seam name (`*AsAdmin`,
 * `*ForAdmin`) or the bypass runner `runAdminCharacterCommandAs`, because a
 * future server caller could otherwise invoke a privileged command on an
 * arbitrary admin-user id while skipping header authorization.
 *
 * The raw seams live in the INTERNAL `server/admin-command-seams.ts` module and
 * are tested directly against a real database; this unit guard keeps them out
 * of the production surface.
 */
describe("admin production command surface (requireAdmin-only)", () => {
  it("exports no raw bypass seam names", async () => {
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
    const mod = (await import("@/server/admin-character")) as Record<string, unknown>;
    const exportedNames = Object.keys(mod).filter((name) => name !== "default");
    expect(exportedNames.includes("runAdminCharacterCommandAs")).toBe(false);
    expect(exportedNames).toContain("runAdminCharacterCommand");
  });
});
