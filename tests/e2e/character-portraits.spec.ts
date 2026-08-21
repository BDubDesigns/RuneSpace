import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import { PLAYER_STARTER_PORTRAITS } from "@/game/content/portrait-catalog";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import { grantPlayerPortraitUnlock } from "@/server/player-portrait-unlocks";
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
 * Issues #65 and #98 mobile-first journeys for the shared portrait chooser:
 * - an unentitled account sees exactly the ten player-starter options, while an
 *   account with Von Scavenger sees the ten starters plus that unlock;
 * - character creation requires a deliberate portrait choice (no locked or
 *   non-selectable cards), works from the
 *   keyboard and by touch, uses the same in-page review state as management
 *   (large preview, Previous/Next with wrap, Back to portraits preserving the
 *   candidate and the typed name), and the choice survives navigation;
 * - a legacy null-portrait character shows the neutral placeholder on a
 *   portrait edit control; the owner reviews and saves; the chooser closes on
 *   success, a transient "Portrait updated" status is announced, focus
 *   returns to the edit control, and the same-location public profile shows
 *   the chosen portrait; failures keep the chooser open and preserve the
 *   candidate; sibling characters on the same account keep their own
 *   selections; no horizontal overflow or private-data exposure occurs.
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
    .delete(rune.characterRefiningState)
    .where(eq(rune.characterRefiningState.characterId, characterId));
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

  test("creation uses the shared chooser: ten starters, review state, and atomic persistence", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/characters/new");

    // Browse state for an account without an entitlement: exactly the ten
    // catalog player-starter options and nothing else.
    const options = page.locator("[data-portrait-option]");
    await expect(options).toHaveCount(10);
    const starterIds = PLAYER_STARTER_PORTRAITS.map((portrait) => portrait.id);
    for (const id of starterIds) {
      await expect(page.locator(`[data-portrait-option][data-portrait-id="${id}"]`)).toHaveCount(1);
    }
    for (const forbidden of ["Baker", "Milkman", "Von Scavenger", "Unicorn Mechanic"]) {
      await expect(page.getByRole("button", { name: new RegExp(forbidden) })).toHaveCount(0);
    }

    // Hiding the option is not the security boundary: a forged server command
    // from the same unentitled account is refused as well.
    const fixtureUser = (
      await db
        .select({ id: authSchema.user.id })
        .from(authSchema.user)
        .where(eq(authSchema.user.name, "Mining Fixture"))
    )[0];
    if (!fixtureUser) throw new Error("Mining fixture user was not created");
    const fixtureAccount = await ownership.ensurePlayerAccount(fixtureUser.id);
    const fixtureCharacter = (
      await db
        .select({ id: rune.characters.id })
        .from(rune.characters)
        .where(eq(rune.characters.playerAccountId, fixtureAccount.id))
    )[0];
    if (!fixtureCharacter) throw new Error("Mining fixture character was not created");
    await expect(
      characters.changeCharacterPortrait(
        fixtureUser.id,
        fixtureCharacter.id,
        PORTRAIT_IDS.vonScavenger,
      ),
    ).rejects.toThrow(/not available/i);
    // Mobile-first: no horizontal overflow in browse state.
    expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Touch activation enters the in-page review state with a large preview;
    // the final action cannot succeed until BOTH the name and a portrait are
    // valid (disabled with an empty name).
    const grammaOption = page.locator(
      `[data-portrait-option][data-portrait-id="${PLAYER_STARTER_PORTRAITS[6]!.id}"]`,
    );
    await grammaOption.tap();
    const review = page.locator('[data-portrait-review="true"]');
    await expect(review).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review portrait" })).toBeFocused();
    await expect(review.locator("[data-portrait-preview-name]")).toHaveText("Gramma");
    const create = page.getByRole("button", { name: "Create character" });
    await expect(create).toBeVisible();
    await expect(create).toBeDisabled();

    // Previous/Next update the candidate and preview, wrapping at the ends.
    await page.getByRole("button", { name: "Previous portrait" }).click();
    await expect(review.locator("[data-portrait-preview-name]")).toHaveText("Zero-G Rock Star");
    await expect(grammaOption).not.toHaveAttribute("data-portrait-selected", "true");
    await page.getByRole("button", { name: "Next portrait" }).click();
    await expect(review.locator("[data-portrait-preview-name]")).toHaveText("Gramma");

    // Back to portraits restores the grid, the candidate, and focus.
    await page.getByRole("button", { name: "Back to portraits" }).click();
    await expect(review).toBeHidden();
    await expect(grammaOption).toBeFocused();
    await expect(grammaOption).toHaveAttribute("aria-pressed", "true");

    // The typed name survives browsing/reviewing.
    const createdName = `Fresh Star ${token()}`;
    await page.getByLabel("Character name").fill(createdName);

    // Keyboard selection: focus an option and confirm with Enter; the action
    // becomes enabled only once both name and portrait are valid.
    const firstOption = page.locator(`[data-portrait-option][data-portrait-id="${starterIds[0]}"]`);
    await firstOption.focus();
    await expect(firstOption).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(review).toBeVisible();
    await expect(review.locator("[data-portrait-preview-name]")).toHaveText("EVA Salvage Welder");
    await expect(firstOption).toHaveAttribute("aria-pressed", "true");
    await expect(firstOption).toHaveAttribute("data-portrait-selected", "true");
    await expect(create).toBeEnabled();

    // Previous wraps from the first option to the last; Next returns.
    await page.getByRole("button", { name: "Previous portrait" }).click();
    await expect(review.locator("[data-portrait-preview-name]")).toHaveText("Space Nerd");
    await page.getByRole("button", { name: "Next portrait" }).click();
    await expect(review.locator("[data-portrait-preview-name]")).toHaveText("EVA Salvage Welder");

    // Returning to the grid preserves the typed name and the candidate.
    await page.getByRole("button", { name: "Back to portraits" }).click();
    await expect(firstOption).toBeFocused();
    await expect(page.getByLabel("Character name")).toHaveValue(createdName);
    await expect(firstOption).toHaveAttribute("data-portrait-selected", "true");

    // Re-enter review and create; the portrait persists atomically with the
    // new character and survives navigation.
    await firstOption.tap();
    await expect(review).toBeVisible();
    await create.click();
    await page.waitForURL(/\/play\/[^/]+$/);
    await page.goto("/characters");
    const row = page.locator("li").filter({ hasText: createdName });
    await expect(row).toBeVisible();
    await expect(row.getByText("No portrait yet", { exact: true })).toHaveCount(0);
    const editControl = row.locator("[data-portrait-edit]");
    await expect(editControl).toBeVisible();
    await expect(editControl).toHaveAttribute("aria-label", `Change portrait for ${createdName}`);
    await expect(row.locator("[data-character-portrait] img")).toBeVisible();
    await expect(row.getByText("EVA Salvage Welder", { exact: true })).toBeVisible();
    await expect(row.getByRole("link", { name: "Play" })).toBeVisible();

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

  test("the portrait edit control drives Choose/Change, save closes with a transient status, and the public profile shows the choice", async ({
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
    const ownerAccount = await ownership.ensurePlayerAccount(ownerId);
    await grantPlayerPortraitUnlock(ownerAccount.id, PORTRAIT_IDS.vonScavenger, "operator");
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

    // The management card uses a portrait EDIT CONTROL (the portrait itself is
    // the button), not a large textual Choose/Change button; Play is the only
    // large textual action.
    const legacyRow = page.locator("li").filter({ hasText: legacyName });
    await expect(legacyRow).toBeVisible();
    await expect(
      legacyRow.getByRole("button", { name: "Choose portrait", exact: true }),
    ).toHaveCount(0);
    const legacyEdit = legacyRow.locator("[data-portrait-edit]");
    await expect(legacyEdit).toHaveCount(1);
    await expect(legacyEdit).toHaveAttribute("aria-label", `Choose portrait for ${legacyName}`);
    await expect(legacyEdit.locator("[data-character-portrait] svg")).toBeVisible();
    await expect(legacyRow.getByText("No portrait yet", { exact: true })).toBeVisible();
    await expect(legacyRow.getByRole("link", { name: "Play" })).toBeVisible();

    // The sibling character on the same account keeps its own portrait
    // selection and its Change edit control.
    const ownedRow = page.locator("li").filter({ hasText: ownedName });
    const ownedEdit = ownedRow.locator("[data-portrait-edit]");
    await expect(ownedEdit).toHaveAttribute("aria-label", `Change portrait for ${ownedName}`);
    await expect(ownedRow.locator("[data-character-portrait] img")).toBeVisible();
    await expect(ownedRow.getByText("Gramma", { exact: true })).toBeVisible();

    // The owned character's chooser distinguishes the CURRENT portrait with a
    // label (never color alone) and disables Save until the candidate differs.
    await ownedEdit.click();
    const dialog = page.getByRole("dialog", { name: "Portrait" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-portrait-option]")).toHaveCount(11);
    const grammaTile = dialog.locator(
      `[data-portrait-option][data-portrait-id="${PORTRAIT_IDS.gramma}"]`,
    );
    await expect(grammaTile).toHaveAttribute("data-portrait-current", "true");
    await expect(grammaTile.getByText("Current", { exact: true })).toBeVisible();
    // Enter review with the current portrait as candidate: Save is disabled
    // because candidate equals current; a different candidate enables it.
    await grammaTile.click();
    const ownedReview = dialog.locator('[data-portrait-review="true"]');
    await expect(ownedReview).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save portrait" })).toBeDisabled();
    // Back to the grid, then choose a different candidate.
    await dialog.getByRole("button", { name: "Back to portraits" }).click();
    await dialog
      .locator(`[data-portrait-option][data-portrait-id="${PORTRAIT_IDS.cargoPilot}"]`)
      .click();
    await expect(dialog.getByRole("button", { name: "Save portrait" })).toBeEnabled();
    // Escape closes the drawer and returns focus to the edit control.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(ownedEdit).toBeFocused();

    // Legacy flow: review a new candidate and save; the chooser closes on
    // success, the transient status is announced, focus returns, and the
    // card shows the updated portrait.
    await legacyEdit.click();
    await expect(dialog).toBeVisible();
    const grampaOption = dialog.locator(
      `[data-portrait-option][data-portrait-id="${PLAYER_STARTER_PORTRAITS[7]!.id}"]`,
    );
    await grampaOption.click();
    const review = dialog.locator('[data-portrait-review="true"]');
    await expect(review).toBeVisible();
    await expect(review.locator("[data-portrait-preview-name]")).toHaveText("Grampa");
    await dialog.getByRole("button", { name: "Save portrait" }).click();

    // Success: drawer closes automatically, transient status appears on the
    // management screen, focus returns to the edit control.
    await expect(dialog).toBeHidden();
    const status = page.locator("[data-transient-status]");
    await expect(status).toHaveText("Portrait updated");
    await expect(status).toHaveAttribute("role", "status");
    await expect(legacyEdit).toBeFocused();

    // The updated larger portrait and label appear on the card; the
    // placeholder is gone.
    await expect(legacyRow.locator("[data-character-portrait] img")).toBeVisible();
    await expect(legacyRow.getByText("Grampa", { exact: true })).toBeVisible();
    await expect(legacyRow.getByText("No portrait yet", { exact: true })).toHaveCount(0);
    await expect(legacyEdit).toHaveAttribute("aria-label", `Change portrait for ${legacyName}`);

    // An owned unlockable is available on the same existing character and
    // renders through the normal presentation path.
    await legacyEdit.click();
    await expect(dialog).toBeVisible();
    const vonOption = dialog.locator(
      `[data-portrait-option][data-portrait-id="${PORTRAIT_IDS.vonScavenger}"]`,
    );
    await vonOption.click();
    await expect(dialog.locator("[data-portrait-preview-name]")).toHaveText("Von Scavenger");
    await dialog.getByRole("button", { name: "Save portrait" }).click();
    await expect(dialog).toBeHidden();
    await expect(legacyRow.getByText("Von Scavenger", { exact: true })).toBeVisible();

    // The same account may choose the unlock again on a newly-created slot.
    const createdWithUnlockName = `Unlocked Slot ${token()}`;
    await page.goto("/characters/new");
    const creationOptions = page.locator("[data-portrait-option]");
    await expect(creationOptions).toHaveCount(11);
    const creationVon = page.locator(
      `[data-portrait-option][data-portrait-id="${PORTRAIT_IDS.vonScavenger}"]`,
    );
    await page.getByLabel("Character name").fill(createdWithUnlockName);
    await creationVon.click();
    await page.getByRole("button", { name: "Create character" }).click();
    await page.waitForURL(/\/play\/[^/]+$/);
    await page.goto("/characters");
    const createdWithUnlockRow = page.locator("li").filter({ hasText: createdWithUnlockName });
    await expect(createdWithUnlockRow.getByText("Von Scavenger", { exact: true })).toBeVisible();

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
      PORTRAIT_IDS.vonScavenger,
      PORTRAIT_IDS.vonScavenger,
    ]);

    // Failure path: a transport failure keeps the chooser open in review
    // state, preserves the candidate, restores the Save action, and shows a
    // styled alert near the action.
    await legacyEdit.click();
    await expect(dialog).toBeVisible();
    const cargoOption = dialog.locator(
      `[data-portrait-option][data-portrait-id="${PORTRAIT_IDS.cargoPilot}"]`,
    );
    await cargoOption.click();
    await expect(review).toBeVisible();
    await page.route("**/characters", (route) => {
      if (route.request().method() === "POST") return route.abort();
      return route.continue();
    });
    await dialog.getByRole("button", { name: "Save portrait" }).click();
    await expect(
      dialog.getByText("Comms interruption. Portrait could not be saved."),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(review).toBeVisible();
    await expect(cargoOption).toHaveAttribute("data-portrait-selected", "true");
    await expect(dialog.getByRole("button", { name: "Save portrait" })).toBeEnabled();
    await page.unroute("**/characters");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

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
    await expect(portrait).toHaveAttribute(
      "alt",
      "Eccentric salvager with a monocle eye device and tools in a salvage workshop",
    );
    expect((await portrait.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(0);
    // No private account data appears in the public profile.
    await expect(panel.getByText("@")).toHaveCount(0);
    await expect(panel.getByText(/email/i)).toHaveCount(0);

    expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/portraits-mobile-profile.png" });
  });
});
