import type { Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import * as rune from "@/db/rune-space";
import * as characters from "@/server/characters";
import * as ownership from "@/server/ownership";
import { standardSkillLevelThresholds } from "@/game/config/balance";
import {
  GAME_TICK_MS,
  ITEM_IDS,
  LOCATION_IDS,
  PORTRAIT_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { whisperParticipantKey } from "@/game/domain/chat";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "../integration/fixtures";
import { expect, openTestCharacter, test } from "./fixtures";
import { captureReviewScreenshot } from "./review-screenshot";

/**
 * Issue #274 — the read-only System conversation, in a real browser at phone
 * width.
 *
 * PostgreSQL coverage owns derivation, atomicity, duplicate safety, the
 * operator exclusion, and read arithmetic. This proves what only a browser
 * can: an ordinary Refining attempt that crosses Refining 5 lights the
 * launcher and the Whispers tab live, System is pinned above a player's
 * Whisper conversation, it opens to the grouped notice with no composer,
 * profile, Block, or Report, and reading it stays read across a reload.
 */

const users: string[] = [];

test.afterEach(async () => {
  for (const userId of users.splice(0)) await cleanupTestUser(db, authSchema, rune, userId);
});

function launcher(page: Page) {
  return page.locator("[data-chat-social-launcher]");
}

async function openChat(page: Page) {
  await launcher(page).click();
  const dialog = page.getByRole("dialog", { name: "Chat" });
  await expect(dialog).toBeVisible();
  return dialog;
}

const whispersTab = (dialog: Locator) => dialog.getByRole("tab", { name: /^Whispers/ });

async function expectNoHorizontalOverflow(page: Page, dialog: Locator) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}

/** A read Whisper from another player, written directly (nothing is published). */
async function seedReadWhisper(me: { id: string; playerAccountId: string }) {
  const userId = await createTestUser(db, authSchema, "System Neighbour");
  users.push(userId);
  const other = await createCharacterForUser(
    db,
    rune,
    ownership,
    characters,
    userId,
    `Neighbour ${randomUUID().slice(0, 6)}`,
    PORTRAIT_IDS.evaSalvageWelder,
    { seedLegacyStarterCutter: false },
  );
  const [conversation] = await db
    .insert(rune.whisperConversations)
    .values({ participantKey: whisperParticipantKey(me.id, other.id) })
    .returning();
  const [message] = await db
    .insert(rune.chatMessages)
    .values({
      channel: "whisper",
      conversationId: conversation!.id,
      senderPlayerAccountId: other.playerAccountId,
      senderCharacterId: other.id,
      senderCharacterName: other.displayName,
      body: "Saw you at the Yard.",
      createdAt: new Date(Date.now() - 60_000),
    })
    .returning();
  await db.insert(rune.whisperParticipants).values([
    {
      conversationId: conversation!.id,
      characterId: me.id,
      playerAccountId: me.playerAccountId,
      lastReadSeq: message!.seq,
    },
    {
      conversationId: conversation!.id,
      characterId: other.id,
      playerAccountId: other.playerAccountId,
    },
  ]);
  return other;
}

test("a real Refining level crossing lights a read-only, pinned System conversation (#274)", async ({
  page,
  testCharacter,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = testCharacter.id;
  const [me] = await db.select().from(rune.characters).where(eq(rune.characters.id, characterId));
  const neighbour = await seedReadWhisper(me!);

  // At the Yard with one batch of Shale, three XP short of Refining 5: a
  // success (15 XP) and a failure (3 XP) both cross the threshold.
  const refiningFive = standardSkillLevelThresholds().find((each) => each.level === 5)!.totalXp;
  await db
    .update(rune.characters)
    .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
    .where(eq(rune.characters.id, characterId));
  await db
    .insert(rune.inventoryStacks)
    .values({ characterId, itemId: ITEM_IDS.ferriteShale, quantity: 2 });
  await db
    .insert(rune.characterSkillXp)
    .values({ characterId, skillId: SKILL_IDS.refining, totalXp: refiningFive - 3 })
    .onConflictDoUpdate({
      target: [rune.characterSkillXp.characterId, rune.characterSkillXp.skillId],
      set: { totalXp: refiningFive - 3 },
    });

  await openTestCharacter(page, characterId);
  await expect(launcher(page)).toHaveAttribute("data-realtime-status", "live");
  await expect(launcher(page)).toHaveAttribute("aria-label", "Chat");

  // Ordinary gameplay: one Refining attempt, fast-forwarded, then resolved.
  await page.getByRole("button", { name: "Start Refining" }).click();
  await expect(page.getByRole("button", { name: "Stop Refining" })).toBeVisible();
  const oneAttemptAgo = new Date(Date.now() - 7 * GAME_TICK_MS - 100);
  await db
    .update(rune.activeActions)
    .set({ startedAt: oneAttemptAgo, resolvedThroughAt: oneAttemptAgo })
    .where(eq(rune.activeActions.characterId, characterId));
  await page.getByRole("button", { name: "Refresh status" }).click();

  // The committed notice arrives live.
  await expect(launcher(page)).toHaveAttribute("aria-label", "Chat, 1 item needs attention");
  const dialog = await openChat(page);
  await expect(whispersTab(dialog)).toHaveAccessibleName("Whispers, 1 unread");
  await whispersTab(dialog).click();

  // System is pinned above the player's conversation.
  const rows = dialog.getByRole("list", { name: "Whisper conversations" }).locator(":scope > li");
  await expect(rows).toHaveCount(2);
  const systemRow = rows.nth(0).locator("[data-system-conversation]");
  await expect(systemRow).toHaveAccessibleName("System, 1 unread");
  await expect(systemRow).toContainText("Refining Level 5 reached.");
  await expect(rows.nth(1).locator(`[data-whisper-conversation="${neighbour.id}"]`)).toBeVisible();
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, "system-notices-inbox-mobile.png");

  // Opening it: the grouped notice, and nothing that treats System as a player.
  await systemRow.click();
  const view = dialog.locator("[data-system-conversation-view]");
  await expect(view.getByRole("heading", { name: "System" })).toBeVisible();
  const notice = view.locator("[data-chat-message]");
  await expect(notice).toHaveCount(1);
  for (const line of [
    "Refining Level 5 reached.",
    "New recipes unlocked:",
    "- Galvanic Stock",
    "- Slag from Ferrite Shale",
    "- Slag from Galvanite",
  ]) {
    await expect(notice).toContainText(line);
  }
  await expect(view.locator("[data-system-read-only]")).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /^(Report|Block|Reply|Whisper)$/ })).toHaveCount(
    0,
  );
  await expect(
    dialog.locator("[data-chat-message-actions-toggle], [data-chat-sender]"),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page, dialog);
  await captureReviewScreenshot(page, "system-notices-conversation-mobile.png");

  // Reading clears unread, and it stays read after a reload.
  await expect(whispersTab(dialog)).toHaveAccessibleName("Whispers");
  await expect(launcher(page)).toHaveAttribute("aria-label", "Chat");
  await page.reload();
  await expect(launcher(page)).toHaveAttribute("data-realtime-status", "live");
  const reopened = await openChat(page);
  await whispersTab(reopened).click();
  await expect(reopened.locator("[data-system-conversation]")).toHaveAttribute(
    "data-system-unread",
    "0",
  );
  await expect(launcher(page)).toHaveAttribute("aria-label", "Chat");
});

test.describe("recipe unlocks on the public site", () => {
  test("Something New to Make is published and links both recipe Wiki pages", async ({ page }) => {
    // Newer Updates have shipped since (#261), so it is found by name, not position.
    await page.goto("/updates");
    const listed = page
      .getByRole("list", { name: "Published Updates" })
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: "Something New to Make", exact: true }) });
    await expect(
      listed.getByRole("link", { name: "Something New to Make", exact: true }),
    ).toHaveAttribute("href", "/updates/something-new-to-make");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/updates/something-new-to-make");
    await expect(page).toHaveTitle("Something New to Make — RuneSpace");
    const article = page.locator("article");
    await expect(article.getByRole("link", { name: "Mining & Refining" })).toHaveAttribute(
      "href",
      "/wiki/mining-and-refining",
    );
    await expect(article.getByRole("link", { name: "Fabrication & Tinkering" })).toHaveAttribute(
      "href",
      "/wiki/fabrication-and-tinkering",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
