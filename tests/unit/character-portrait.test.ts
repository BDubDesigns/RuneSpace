import { describe, expect, it } from "vitest";
import { PLAYER_STARTER_PORTRAITS, PORTRAITS } from "@/game/content/portrait-catalog";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import {
  getSelectablePortraitOptions,
  isSelectablePortrait,
  resolveCharacterPortrait,
} from "@/game/domain/character-portrait";

/**
 * Issue #65 domain coverage for the character-portrait boundary:
 * - the picker option set is derived from the authoritative catalog and
 *   contains exactly the ten player-starter entries until an account owns an
 *   unlockable — never npc-only, reserved, or unknown IDs;
 * - the neutral placeholder is distinct from every selectable catalog portrait
 *   and is never a catalog entry;
 * - valid selected IDs resolve to the approved safe presentation;
 * - null, unknown, malformed, retired, and non-selectable IDs resolve to the
 *   neutral placeholder;
 * - the public projection exposes only approved presentation fields;
 * - selected-state mapping is generic, not hardcoded to one portrait.
 */

describe("issue #65 selectable portrait options", () => {
  it("derives exactly the ten player-starter entries from the catalog in approved order", () => {
    const options = getSelectablePortraitOptions();
    expect(options).toHaveLength(10);
    expect(options.map((option) => option.portraitId)).toEqual(
      PLAYER_STARTER_PORTRAITS.map((portrait) => portrait.id),
    );
  });

  it("contains only player-starter catalog identities — no npc-only, reserved, or unknown IDs", () => {
    const starterIds = new Set(
      PORTRAITS.filter((portrait) => portrait.category === "player-starter").map(
        (portrait) => portrait.id,
      ),
    );
    const options = getSelectablePortraitOptions();
    expect(options.every((option) => starterIds.has(option.portraitId))).toBe(true);
    for (const id of [
      PORTRAIT_IDS.baker,
      PORTRAIT_IDS.milkman,
      PORTRAIT_IDS.vonScavenger,
      "portrait_unknown_01",
    ]) {
      expect(options.some((option) => option.portraitId === id)).toBe(false);
    }
    // The neutral placeholder is not a catalog portrait and never appears in
    // the selectable option set.
    expect(resolveCharacterPortrait(null)).toEqual({ kind: "placeholder" });
  });

  it("projects owned Von Scavenger once and ignores invalid or unapproved owned IDs", () => {
    const options = getSelectablePortraitOptions([
      PORTRAIT_IDS.vonScavenger,
      PORTRAIT_IDS.vonScavenger,
      PORTRAIT_IDS.baker,
      PORTRAIT_IDS.unicornMechanic,
      "portrait_unknown_01",
    ]);
    expect(options).toHaveLength(11);
    expect(options.at(-1)?.portraitId).toBe(PORTRAIT_IDS.vonScavenger);
    expect(
      options.filter((option) => option.portraitId === PORTRAIT_IDS.vonScavenger),
    ).toHaveLength(1);
    expect(isSelectablePortrait(PORTRAIT_IDS.vonScavenger)).toBe(false);
    expect(isSelectablePortrait(PORTRAIT_IDS.vonScavenger, [PORTRAIT_IDS.vonScavenger])).toBe(true);
    expect(isSelectablePortrait(PORTRAIT_IDS.baker, [PORTRAIT_IDS.baker])).toBe(false);
  });
});

describe("issue #65 portrait resolution", () => {
  it("resolves every selectable starter ID to its approved safe presentation", () => {
    for (const portrait of PLAYER_STARTER_PORTRAITS) {
      const resolved = resolveCharacterPortrait(portrait.id);
      expect(resolved).toEqual({
        kind: "selected",
        displayName: portrait.displayName,
        derivativePath: portrait.derivativePath,
        derivativeWidth: portrait.derivativeWidth,
        derivativeHeight: portrait.derivativeHeight,
        accessibleDescription: portrait.accessibleDescription,
      });
    }
  });

  it("resolves null, unknown, malformed, retired, and non-selectable values to the neutral placeholder", () => {
    for (const value of [
      null,
      undefined,
      "",
      "not_a_portrait",
      "portrait_unknown_01",
      // Retired simulation: well-formed stable-ID shape, no longer registered.
      "portrait_retired_01",
      PORTRAIT_IDS.baker, // npc-only
      PORTRAIT_IDS.milkman, // npc-only
      PORTRAIT_IDS.vonScavenger, // player-unlockable but unowned
      PORTRAIT_IDS.unicornMechanic, // reserved
    ]) {
      expect(resolveCharacterPortrait(value)).toEqual({ kind: "placeholder" });
    }
  });

  it("is generic: selection mapping is not hardcoded to one portrait", () => {
    const gramma = resolveCharacterPortrait(PORTRAIT_IDS.gramma);
    const rockStar = resolveCharacterPortrait(PORTRAIT_IDS.zeroGRockStar);
    expect(gramma).toMatchObject({ kind: "selected", displayName: "Gramma" });
    expect(rockStar).toMatchObject({ kind: "selected", displayName: "Zero-G Rock Star" });
    expect(gramma).not.toEqual(rockStar);
  });

  it("resolves an owned unlockable and rejects it without ownership", () => {
    expect(resolveCharacterPortrait(PORTRAIT_IDS.vonScavenger)).toEqual({ kind: "placeholder" });
    expect(
      resolveCharacterPortrait(PORTRAIT_IDS.vonScavenger, [PORTRAIT_IDS.vonScavenger]),
    ).toMatchObject({
      kind: "selected",
      displayName: "Von Scavenger",
    });
    expect(
      resolveCharacterPortrait(PORTRAIT_IDS.unicornMechanic, [PORTRAIT_IDS.unicornMechanic]),
    ).toEqual({ kind: "placeholder" });
  });
});

describe("issue #65 public projection shape", () => {
  it("exposes only the approved presentation fields for a selected portrait", () => {
    const resolved = resolveCharacterPortrait(PORTRAIT_IDS.grampa);
    expect(Object.keys(resolved).sort()).toEqual([
      "accessibleDescription",
      "derivativeHeight",
      "derivativePath",
      "derivativeWidth",
      "displayName",
      "kind",
    ]);
    // Raw internal values never leave the boundary.
    expect(JSON.stringify(resolved)).not.toContain("category");
    expect(JSON.stringify(resolved)).not.toContain("masterPath");
    expect(JSON.stringify(resolved)).not.toContain("concept");
    expect(JSON.stringify(resolved)).not.toContain("portraitId");
  });

  it("exposes a stable placeholder presentation for invalid values", () => {
    expect(resolveCharacterPortrait("nope")).toEqual({ kind: "placeholder" });
    expect(Object.keys(resolveCharacterPortrait("nope")).sort()).toEqual(["kind"]);
  });
});
