import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import { PLAYER_STARTER_PORTRAITS } from "@/game/content/portrait-catalog";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import {
  cleanupTestUser,
  createCharacterForUser,
  createLegacyCharacterForUser,
} from "../integration/fixtures";
import { miningStorageStatePath } from "./mining.setup";
import { populationDisclosure } from "./population-disclosure";

const e2eDatabaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";

test.beforeAll(() => {
  if (e2eDatabaseHost !== "localhost" && e2eDatabaseHost !== "127.0.0.1") {
    throw new Error(
      "Character portrait E2E fixtures require a disposable localhost PostgreSQL database",
    );
  }
});

/**
 * Issue #65 mobile-first journeys:
 * - character creation requires a deliberate portrait choice (exactly the ten
 *   player-starter options, no locked or non-selectable cards), works from the
 *   keyboard and by touch/click, and the choice survives navigation;
 * - a legacy null-portrait character shows the neutral placeholder and a
 *   Choose portrait action; the owner selects and saves; success feedback
 *   appears; the same-location public profile shows the chosen portrait;
 *   sibling characters on the same account keep their own selections; no
 *   horizontal overflow or private-data exposure occurs.
 *
 * Registrations are kept minimal (the fixture user for the creation journey,
 * one owner for the management journey) so the phase stays well under the
 * Better Auth sign-up rate limit.
 */

/** Short unique token so seeded names never collide with leftovers. */
const token = () => Math.random().toString(36).slice(2, 8);

function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/**
 * FK-safe removal of one character and all of its gameplay rows. The creation
 * journey borrows the shared mining-fixture account, so the character it
 * creates is removed afterwards to leave that account exactly as it was for
 * the later play-boundary check.
 */
async function deleteCharacter(characterId: string) {
  await db
    .delete(rune.characterPowerCellDailyClaims)
    .where(eq(rune.characterPowerCellDailyClaims.characterId, characterId));
  await db
    .delete(rune.characterMiningState)
    .where(eq(rune.characterMiningState.characterId, characterId));
  await db
    .delete(rune.characterStarterProvisioning)
    .where(eq(rune.characterStarterProvisioning.characterId, characterId));
  await db
    .delete(rune.characterTravelState)
    .where(eq(rune.characterTravelState.characterId, characterId));
  await db.delete(rune.equippedItems).where(eq(rune.equippedItems.characterId, characterId));
  await db.delete(rune.activeActions).where(eq(rune.activeActions.characterId, characterId));
  await db.delete(rune.characterSkillXp).where(eq(rune.characterSkillXp.characterId, characterId));
  await db.delete(rune.inventoryStacks).where(eq(rune.inventoryStacks.characterId, characterId));
  await db.delete(rune.itemInstances).where(eq(rune.itemInstances.characterId, characterId));
  await db.delete(rune.characters).where(eq(rune.characters.id, characterId));
}

// ---------------------------------------------------------------------------
// New-character journey (authenticated fixture user with free slots)
// ---------------------------------------------------------------------------

test.describe("character creation portrait journey", () => {
  // Real touch input: the journey proves both keyboard and touch selection
  // (hasTouch enables a genuine tap, not a mouse click at a mobile viewport).
  test.use({ storageState: miningStorageStatePath, hasTouch: true });
  test.describe.configure({ mode: "serial" });

  test("creation requires one deliberate portrait choice from exactly the ten starters", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/characters/new");

    // The picker exposes exactly the ten catalog player-starter options and
    // nothing else: no npc-only, reserved, unknown, or locked cards.
    const options = page.locator("[data-portrait-option]");
    await expect(options).toHaveCount(10);
    const starterIds = PLAYER_STARTER_PORTRAITS.map((portrait) => portrait.id);
    for (const id of starterIds) {
      await expect(page.locator(`[data-portrait-option][data-portrait-id="${id}"]`)).toHaveCount(1);
    }
    for (const forbidden of ["Baker", "Milkman", "Von Scavenger", "Unicorn Mechanic"]) {
      await expect(page.getByRole("button", { name: new RegExp(forbidden) })).toHaveCount(0);
    }

    // The final action cannot succeed until BOTH the name and a portrait are
    // valid: disabled with no input, still disabled with only a name.
    const create = page.getByRole("button", { name: "Create character" });
    await expect(create).toBeDisabled();
    const createdName = `Fresh Star ${token()}`;
    await page.getByLabel("Character name").fill(createdName);
    await expect(create).toBeDisabled();

    // Keyboard selection: focus an option and confirm with Enter.
    const firstOption = page.locator(`[data-portrait-option][data-portrait-id="${starterIds[0]}"]`);
    await firstOption.focus();
    await expect(firstOption).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(firstOption).toHaveAttribute("aria-pressed", "true");
    await expect(firstOption).toHaveAttribute("data-portrait-selected", "true");
    await expect(create).toBeEnabled();

    // Touch selection (a real tap) transfers the clear selected state to
    // another option and back to the first.
    const grammaOption = page.locator(
      `[data-portrait-option][data-portrait-id="${PLAYER_STARTER_PORTRAITS[6]!.id}"]`,
    );
    await grammaOption.tap();
    await expect(grammaOption).toHaveAttribute("aria-pressed", "true");
    await expect(firstOption).not.toHaveAttribute("data-portrait-selected", "true");
    await firstOption.tap();
    await expect(firstOption).toHaveAttribute("data-portrait-selected", "true");

    // Mobile-first: the creation screen has no horizontal overflow.
    expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Creation succeeds with the selected portrait and persists across
    // navigation.
    await create.click();
    await page.waitForURL(/\/play\/[^/]+$/);
    await page.goto("/characters");
    const row = page.locator("li").filter({ hasText: createdName });
    await expect(row).toBeVisible();
    await expect(row.getByText("No portrait yet", { exact: true })).toHaveCount(0);
    const rowPortrait = row.locator("[data-character-portrait] img");
    await expect(rowPortrait).toBeVisible();
    expect((await rowPortrait.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(0);
    await expect(row.getByText("EVA Salvage Welder", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Change portrait" })).toBeVisible();

    // Leave the shared fixture account exactly as it was: remove the created
    // character (and its gameplay rows) so later phases that reuse the same
    // account see a single unambiguous character.
    const created = (
      await db
        .select({ id: rune.characters.id })
        .from(rune.characters)
        .where(eq(rune.characters.displayName, createdName))
    )[0];
    if (created) await deleteCharacter(created.id);
  });
});

// ---------------------------------------------------------------------------
// Existing-character journey (owner with a legacy null portrait)
// ---------------------------------------------------------------------------

test.describe("existing character portrait management journey", () => {
  const createdUsers: string[] = [];

  test.afterAll(async () => {
    for (const userId of createdUsers.splice(0)) {
      await cleanupTestUser(db, authSchema, rune, userId);
    }
  });

  test("a legacy null character gets a Choose/Change portrait flow; the public profile shows the choice", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });

    // Register one owner through the UI (so the seeded characters are
    // genuinely owned by the authenticated session), then seed two characters
    // for that same account: one created WITH a portrait through the
    // authoritative command (slot 1) and one legacy (pre-portrait) character
    // with a NULL portrait (slot 2).
    const ownerEmail = `portrait-owner-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    await page.goto("/register");
    await page.getByLabel("Display name").fill("Portrait Owner");
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password", { exact: true }).fill("sup3r-secret-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("link", { name: "New character" })).toBeVisible();
    const owner = (
      await db
        .select({ id: authSchema.user.id })
        .from(authSchema.user)
        .where(eq(authSchema.user.email, ownerEmail))
    )[0];
    if (!owner) throw new Error("Portrait owner fixture user was not created");
    const ownerId = owner.id;
    createdUsers.push(ownerId);
    const ownedName = `Owned Drifter ${token()}`;
    const legacyName = `Legacy Drifter ${token()}`;
    await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      ownerId,
      ownedName,
      PORTRAIT_IDS.gramma,
    );
    await createLegacyCharacterForUser(db, rune, ownership, ownerId, legacyName, 2);
    await page.goto("/characters");

    // The legacy character displays the neutral placeholder and a Choose
    // portrait action.
    const legacyRow = page.locator("li").filter({ hasText: legacyName });
    await expect(legacyRow).toBeVisible();
    await expect(legacyRow.getByText("No portrait yet", { exact: true })).toBeVisible();
    await expect(legacyRow.locator("[data-character-portrait] svg")).toBeVisible();
    const choose = legacyRow.getByRole("button", { name: "Choose portrait" });
    await expect(choose).toBeVisible();

    // The sibling character on the same account keeps its own portrait
    // selection (chosen at creation) and its Change action.
    const ownedRow = page.locator("li").filter({ hasText: ownedName });
    await expect(ownedRow.getByRole("button", { name: "Change portrait" })).toBeVisible();
    await expect(ownedRow.locator("[data-character-portrait] img")).toBeVisible();
    await expect(ownedRow.getByText("Gramma", { exact: true })).toBeVisible();

    // Open the shared picker, choose a portrait, and save.
    await choose.click();
    const dialog = page.getByRole("dialog", { name: "Portrait" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-portrait-option]")).toHaveCount(10);

    const grampaOption = dialog.locator(
      `[data-portrait-option][data-portrait-id="${PLAYER_STARTER_PORTRAITS[7]!.id}"]`,
    );
    await grampaOption.click();
    await expect(grampaOption).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "Save portrait" }).click();

    // Visible success feedback appears.
    await expect(dialog.getByText("Portrait saved", { exact: true })).toBeVisible();

    // Cancel path: Escape closes the dialog and returns focus to the trigger
    // (which now reads "Change portrait" after the server refresh).
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(legacyRow.getByRole("button", { name: /portrait/i })).toBeFocused();

    // The row now shows the chosen portrait, its label, and the Change action;
    // the placeholder is gone.
    await expect(legacyRow.locator("[data-character-portrait] img")).toBeVisible();
    await expect(legacyRow.getByText("Grampa", { exact: true })).toBeVisible();
    await expect(legacyRow.getByText("No portrait yet", { exact: true })).toHaveCount(0);
    await expect(legacyRow.getByRole("button", { name: "Change portrait" })).toBeVisible();

    // Only the requested character changed: the sibling keeps its own
    // selection in the database, and the legacy row stored only the stable
    // portrait ID.
    const siblings = await db
      .select({ displayName: rune.characters.displayName, portraitId: rune.characters.portraitId })
      .from(rune.characters)
      .where(eq(rune.characters.playerAccountId, (await ownership.ensurePlayerAccount(ownerId)).id))
      .orderBy(rune.characters.slot);
    expect(siblings.map((sibling) => sibling.portraitId)).toEqual([
      PORTRAIT_IDS.gramma,
      PORTRAIT_IDS.grampa,
    ]);

    // Mobile-first: no horizontal overflow on the management screen.
    expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/portraits-mobile-characters.png" });

    // The same-location public profile shows the chosen portrait without
    // private data: play the sibling character so the legacy character is a
    // same-location public target.
    await ownedRow.getByRole("link", { name: "Play" }).click();
    await page.waitForURL(/\/play\/[^/]+$/);

    await populationDisclosure(page).click();
    await page
      .getByRole("button", {
        name: new RegExp(`^${legacyName}, Level 1, player Portrait Owner$`),
      })
      .click();

    const panel = page.locator("[data-character-profile-panel]");
    await expect(panel).toBeVisible();
    const portrait = panel.locator("[data-character-portrait] img");
    await expect(portrait).toBeVisible();
    expect((await portrait.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(0);
    // No private account data appears in the public profile.
    await expect(panel.getByText("@")).toHaveCount(0);
    await expect(panel.getByText(/email/i)).toHaveCount(0);

    expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/portraits-mobile-profile.png" });
  });
});
