import {
  expect,
  expectExteriorMissionHalo,
  expectKeyboardFocusRingPaints,
  expectPointerFocusWithoutRing,
  openConversationEntry,
  openMapSurface,
  openNpcConversation,
  test,
  openTestCharacter,
} from "./fixtures";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMissions,
  characters,
  equippedItems,
  itemInstances,
} from "@/db/rune-space";
import { ITEM_IDS, LOCATION_IDS, MISSION_IDS } from "@/game/config/foundations";

test.beforeEach(async ({ page, testCharacter }) => {
  await openTestCharacter(page, testCharacter.id);
});

async function fastForwardArrival(page: import("@playwright/test").Page, characterId: string) {
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  const ago = new Date(Date.now() - 25_000);
  await db
    .update(activeActions)
    .set({ startedAt: ago, resolvedThroughAt: ago })
    .where(eq(activeActions.characterId, characterId));
  await page.reload();
}

test("walks from Wade to Tansy, presents approved dialogue, and claims one carried Cutter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  await expect(page.getByRole("button", { name: "Inventory" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Wade Rusk/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Talk to Wade Rusk/ })).toHaveAttribute(
    "data-npc-turn-in",
    "false",
  );
  // Mission guidance: brand-new character at Crash Site — Wade's Talk
  // control receives the mission-available (blue) treatment, including an
  // exterior halo painted outside the beveled button's clip.
  await expectExteriorMissionHalo(
    page.getByRole("button", { name: /Talk to Wade Rusk/ }),
    "available",
  );
  // Keyboard focus paints its own ring on top of the blue guidance (#173);
  // pointer focus does not.
  await expectKeyboardFocusRingPaints(page.getByRole("button", { name: /Talk to Wade Rusk/ }));
  await expectPointerFocusWithoutRing(page.getByRole("button", { name: /Talk to Wade Rusk/ }));
  // Talk opens the conversation hub (#164): the available Mission conversation
  // above Wade's replayable social topic.
  const conversation = await openNpcConversation(page, "Wade Rusk");
  const walkItOffEntry = conversation.getByRole("button", { name: /Walk It Off/ });
  await expect(walkItOffEntry).toHaveAttribute("data-mission-guidance", "available");
  await expect(walkItOffEntry).toContainText("Available");
  // The hub entry is not beveled, so it keeps the direct exterior treatment.
  await expect(walkItOffEntry).toHaveClass(/\brs-mission-available\b/);
  expect(await walkItOffEntry.evaluate((element) => getComputedStyle(element).clipPath)).toBe(
    "none",
  );
  await expect(conversation.getByRole("button", { name: /Recovery work/ })).toBeVisible();
  await openConversationEntry(conversation, /Walk It Off/);
  const dialogue = conversation;
  await expect(dialogue.locator("[data-dialogue-scene-location]")).toHaveText("CRASH SITE");
  await expect(dialogue.locator("[data-dialogue-speaker-name]")).toHaveText("Wade Rusk");
  await expect(dialogue.locator("[data-dialogue-speaker-role]")).toHaveText(
    "Holo Hollow recovery & salvage operator",
  );
  await expect(dialogue.locator('img[alt*="Fractured dark hull"]')).toBeVisible();
  await expect(dialogue.locator('img[alt*="Wade Rusk"]')).toBeVisible();
  await expect(dialogue.getByRole("button", { name: "Restart dialogue" })).toBeVisible();
  await dialogue.locator("[data-dialogue-text]").click();
  await dialogue.getByRole("button", { name: "Next" }).click();
  const visibleDialogueText = dialogue.locator('[data-dialogue-text] [aria-hidden="true"]');
  const secondBeatText = await dialogue.locator("[data-dialogue-text] .sr-only").textContent();
  await expect
    .poll(async () => (await visibleDialogueText.textContent()).replace("_", "").length)
    .toBeLessThan(secondBeatText?.length ?? 0);
  await visibleDialogueText.click();
  await dialogue.getByRole("button", { name: "Next" }).click();
  for (let index = 2; index < 13; index += 1) {
    await visibleDialogueText.click();
    if (index < 12) await dialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialogue.getByRole("button", { name: "Accept mission" })).toBeVisible();
  await dialogue.getByRole("button", { name: "Accept mission" }).click();
  // A successful acceptance returns to the freshly derived hub: the same
  // Mission now reads as Active and the social topic is still available.
  await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
  await expect(conversation.getByRole("button", { name: /Walk It Off/ })).toContainText("Active");
  await expect(conversation.getByRole("button", { name: /Recovery work/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(conversation).toBeHidden();
  await expect(page.locator("[data-mission-objective]")).toContainText("Travel to The Jag");

  // Issue #129: after accepting Walk It Off from Wade but before leaving Crash
  // Site, talking to Wade again must show the active follow-up, not the
  // Cutter-aware completed dialogue. Assert behaviour, not just ID.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wadeActiveFollowUp = await openNpcConversation(page, "Wade Rusk");
  await openConversationEntry(wadeActiveFollowUp, /Walk It Off/);
  await expect(
    wadeActiveFollowUp.locator('[data-dialogue-text] [aria-hidden="true"]'),
  ).toContainText("The Jag");
  await expect(
    wadeActiveFollowUp.locator('[data-dialogue-text] [aria-hidden="true"]'),
  ).toContainText("The Long Scramble");
  await wadeActiveFollowUp.getByRole("button", { name: "Next" }).click();
  await expect(
    wadeActiveFollowUp.locator('[data-dialogue-text] [aria-hidden="true"]'),
  ).toContainText("Scavenging");
  await wadeActiveFollowUp.getByRole("button", { name: "Next" }).click();
  // Must not imply the Cutter has already been received — the active follow-up
  // is pre-Cutter by design.
  const wadeFollowUpVisible = await wadeActiveFollowUp
    .locator('[data-dialogue-text] [aria-hidden="true"]')
    .textContent();
  expect(wadeFollowUpVisible?.toLowerCase()).not.toContain("cutter");
  await expect(wadeActiveFollowUp.getByRole("button", { name: "Finish" })).toBeVisible();
  // Finishing a sequence returns to the hub; closing dismisses the surface.
  await wadeActiveFollowUp.getByRole("button", { name: "Finish" }).click();
  await expect(wadeActiveFollowUp.locator("[data-conversation-hub]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(wadeActiveFollowUp).toBeHidden();

  await openMapSurface(page);
  await page
    .getByRole("button", { name: /The Long Scramble/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Walk to The Long Scramble/ }).click();
  await expect(page.locator("[data-mission-objective]")).toContainText("Travel to The Jag");
  await expect(page.locator("[data-npc-interaction]")).toHaveCount(0);
  await fastForwardArrival(page, characterId);
  await openMapSurface(page);
  await page
    .getByRole("button", { name: /The Jag/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Walk to The Jag/ }).click();
  await fastForwardArrival(page, characterId);

  const missionObjective = page.locator("[data-mission-objective]");
  await expect(missionObjective).toContainText("Talk to Tansy Rusk");
  await expect(
    missionObjective.locator('xpath=following-sibling::*[1][@data-npc-interaction="true"]'),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).toHaveAttribute(
    "data-npc-turn-in",
    "true",
  );
  // Mission guidance: the required NPC interaction now receives the active
  // (green) treatment.
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).toHaveAttribute(
    "data-mission-guidance",
    "active",
  );
  // ...and keyboard focus still paints its own ring on top of the green (#173).
  await expectKeyboardFocusRingPaints(page.getByRole("button", { name: /Talk to Tansy Rusk/ }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tansyDialogue = await openNpcConversation(page, "Tansy Rusk");
  const turnInEntry = tansyDialogue.getByRole("button", { name: /Walk It Off/ });
  await expect(turnInEntry).toContainText("Turn in");
  await expect(turnInEntry).toHaveAttribute("data-mission-guidance", "active");
  await openConversationEntry(tansyDialogue, /Walk It Off/);
  for (let index = 0; index < 8; index += 1) {
    await tansyDialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(tansyDialogue.getByRole("button", { name: "Claim Cutter" })).toBeVisible();
  await tansyDialogue.getByRole("button", { name: "Claim Cutter" }).click();
  // The successful grant reveals the Cutter itself over The Jag before Tansy returns.
  const cutterReveal = tansyDialogue.locator('[data-dialogue-subject="item"]');
  await expect(cutterReveal).toBeVisible();
  await expect(cutterReveal.locator("[data-dialogue-item-artwork] img")).toBeVisible();
  await expect(
    tansyDialogue.locator('[data-dialogue-subject="item"] img[alt*="Tansy"]'),
  ).toHaveCount(0);
  await expect(tansyDialogue.locator("[data-dialogue-speaker-name]")).toHaveText("Item");
  await expect(tansyDialogue.locator("[data-dialogue-speaker-role]")).toContainText(
    "Salvage Cutter",
  );
  await expect(tansyDialogue.getByRole("button", { name: "Next" })).toBeVisible();
  await tansyDialogue.getByRole("button", { name: "Next" }).click();
  await expect(tansyDialogue.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "When you get that ship flying again",
  );
  await expect(tansyDialogue.locator('img[alt*="Tansy Rusk"]')).toBeVisible();
  await tansyDialogue.getByRole("button", { name: "Next" }).click();
  await expect(tansyDialogue.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "For now, learn how to use the Cutter",
  );
  await expect(tansyDialogue.getByRole("button", { name: "Finish" })).toBeVisible();
  await tansyDialogue.getByRole("button", { name: "Finish" }).click();
  await expect(tansyDialogue.locator("[data-conversation-hub]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tansyDialogue).toBeHidden();
  await expect(page.getByRole("button", { name: "Inventory" })).toBeVisible();
  // Issue #137: completing Walk It Off atomically accepts Cut Your Teeth via
  // the authored continuation — the HUD immediately shows the next
  // assignment's live objective (already at The Jag, so location holds) with
  // no second acceptance click.
  await expect(page.locator("[data-mission-objective]")).toContainText("Cut Your Teeth");
  await expect(page.locator("[data-mission-objective]")).toContainText("Active");
  await expect(page.locator("[data-mission-objective]")).toContainText(
    "Equip the Salvage Cutter from Inventory",
  );
  // Mission guidance: Cut Your Teeth is accepted, so the equip affordance —
  // not Tansy's Talk control — carries the active treatment.
  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).not.toHaveAttribute(
    "data-mission-guidance",
    "available",
  );

  const cutter = await db
    .select()
    .from(itemInstances)
    .where(eq(itemInstances.characterId, characterId));
  expect(cutter.filter((item) => item.itemId === ITEM_IDS.salvageCutter)).toHaveLength(1);
  await expect(
    db
      .select()
      .from(equippedItems)
      .where(
        eq(
          equippedItems.itemInstanceId,
          cutter.find((item) => item.itemId === ITEM_IDS.salvageCutter)!.id,
        ),
      ),
  ).resolves.toHaveLength(0);

  await page.reload();
  // After Walk It Off completes, the objective panel tracks the continued
  // Cut Your Teeth assignment (accepted atomically, not advertised).
  await expect(page.locator("[data-mission-objective]")).toContainText("Cut Your Teeth");
  await expect(page.locator("[data-mission-objective]")).toContainText("Active");
  // Issue #137: Tansy routes to Cut Your Teeth's active equip reminder — the
  // mission is already accepted, so there is no offer to accept.
  const postMissionDialogue = await openNpcConversation(page, "Tansy Rusk");
  await expect(postMissionDialogue.getByRole("button", { name: /Cut Your Teeth/ })).toContainText(
    "Active",
  );
  await openConversationEntry(postMissionDialogue, /Cut Your Teeth/);
  await expect(
    postMissionDialogue.locator('[data-dialogue-text] [aria-hidden="true"]'),
  ).toContainText("Equip it first");
  await expect(postMissionDialogue.locator('img[alt*="Tansy Rusk"]')).toBeVisible();
});

test("supports the explorer-first Jag conversation and remote mission acceptance", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const characterId = page.url().split("/").at(-1)!;

  await openMapSurface(page);
  await page
    .getByRole("button", { name: /The Long Scramble/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Walk to The Long Scramble/ }).click();
  await fastForwardArrival(page, characterId);
  await openMapSurface(page);
  await page
    .getByRole("button", { name: /The Jag/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Walk to The Jag/ }).click();
  await fastForwardArrival(page, characterId);

  await expect(page.getByRole("button", { name: /Talk to Tansy Rusk/ })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dialogue = await openNpcConversation(page, "Tansy Rusk");
  // Explorer-first: Tansy's own Walk It Off offer route, alongside her
  // ordinary replayable topic.
  await expect(dialogue.getByRole("button", { name: /Walk It Off/ })).toHaveAttribute(
    "data-mission-guidance",
    "available",
  );
  await expect(dialogue.getByRole("button", { name: /^Mining/ })).toBeVisible();
  await openConversationEntry(dialogue, /Walk It Off/);
  await expect(dialogue.locator('img[alt*="Tansy Rusk"]')).toBeVisible();
  await expect(dialogue.locator('img[alt*="Exposed jagged Ferrite Shale"]')).toBeVisible();
  await expect(dialogue.locator("[data-dialogue-scene-location]")).toHaveText("THE JAG");
  await expect(dialogue.locator("[data-dialogue-speaker-name]")).toHaveText("Tansy Rusk");
  await expect(dialogue.locator("[data-dialogue-speaker-role]")).toHaveText(
    "Field mechanic & miner",
  );

  for (let index = 0; index < 4; index += 1) {
    await dialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialogue.getByText("COMMS LINK", { exact: true })).toBeVisible();
  await expect(dialogue.locator("[data-dialogue-scene-location]")).toHaveText("CRASH SITE");
  await expect(dialogue.locator("[data-dialogue-speaker-name]")).toHaveText("Wade Rusk");
  await expect(dialogue.locator("[data-dialogue-speaker-role]")).toHaveText(
    "Holo Hollow recovery & salvage operator",
  );
  await expect(dialogue.locator('img[alt*="Wade Rusk, scowl"]')).toBeVisible();

  for (let index = 4; index < 15; index += 1) {
    await dialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialogue.getByRole("button", { name: "Accept mission" })).toBeVisible();
  await dialogue.getByRole("button", { name: "Accept mission" }).click();
  await expect(dialogue.locator('[data-dialogue-text] [aria-hidden="true"]')).toHaveText(
    "Works for me.",
  );
  for (let index = 0; index < 3; index += 1) {
    await dialogue.getByRole("button", { name: "Next" }).click();
  }
  await expect(dialogue.getByRole("button", { name: "Claim Cutter" })).toBeVisible();
  await dialogue.getByRole("button", { name: "Claim Cutter" }).click();
  await expect(dialogue.locator('[data-dialogue-subject="item"]')).toBeVisible();
  await expect(dialogue.locator("[data-dialogue-speaker-name]")).toHaveText("Item");
  await dialogue.getByRole("button", { name: "Next" }).click();
  await expect(dialogue.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "When you get that ship flying again",
  );
  await dialogue.getByRole("button", { name: "Next" }).click();
  await expect(dialogue.getByRole("button", { name: "Finish" })).toBeVisible();
  await dialogue.getByRole("button", { name: "Finish" }).click();
  await expect(dialogue.locator("[data-conversation-hub]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialogue).toBeHidden();
  // Same boundary as test 1: after Walk It Off completes, the continuation
  // accepts Cut Your Teeth atomically — the HUD tracks it as Active.
  await expect(page.locator("[data-mission-objective]")).toContainText("Cut Your Teeth");
  await expect(page.locator("[data-mission-objective]")).toContainText("Active");
});

test("keeps social topics replayable and gates Beyond Holo Hollow behind Hold It Together", async ({
  page,
  testCharacter,
}) => {
  const characterId = testCharacter.id;
  await page.setViewportSize({ width: 390, height: 844 });
  const now = new Date();
  // Seed the authoritative rows for the state under test: the starter chain
  // completed through Waste Not, with Hold It Together still active.
  await db
    .update(characters)
    .set({ currentLocationId: LOCATION_IDS.theJag })
    .where(eq(characters.id, characterId));
  await db.insert(characterMissions).values([
    { characterId, missionId: MISSION_IDS.walkItOff, acceptedAt: now, completedAt: now },
    { characterId, missionId: MISSION_IDS.cutYourTeeth, acceptedAt: now, completedAt: now },
    { characterId, missionId: MISSION_IDS.wasteNot, acceptedAt: now, completedAt: now },
    { characterId, missionId: MISSION_IDS.holdItTogether, acceptedAt: now },
  ]);
  await openTestCharacter(page, characterId);
  await page.reload();
  await page.emulateMedia({ reducedMotion: "reduce" });

  // The hub separates the current Mission conversation from replayable topics.
  const conversation = await openNpcConversation(page, "Tansy Rusk");
  await expect(
    conversation.locator('[data-conversation-section="current"]').getByRole("button"),
  ).toHaveCount(1);
  const topics = conversation.locator('[data-conversation-section="topics"]').getByRole("button");
  await expect(topics).toHaveCount(1);
  await expect(topics.first()).toContainText("Mining");
  await expect(conversation.getByRole("button", { name: /Beyond Holo Hollow/ })).toHaveCount(0);

  // An ordinary topic plays and returns to the hub, then plays again — topics
  // are replayable and nothing records that one was opened.
  for (let pass = 0; pass < 2; pass += 1) {
    await openConversationEntry(conversation, /^Mining/);
    await expect(conversation.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
      "It's a seam, not a mine",
    );
    // A social topic never exposes a Mission command.
    await expect(conversation.locator("[data-dialogue-action]")).toHaveCount(0);
    // Back from the first beat returns to the hub without touching the world.
    await conversation.getByRole("button", { name: "Back to conversation topics" }).click();
    await expect(conversation.locator("[data-conversation-hub]")).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(conversation).toBeHidden();
  // Selecting topics changed no world state.
  await expect(page.locator("[data-mission-objective]")).toContainText("Hold It Together");

  // Completing Hold It Together unlocks the authored gated topic.
  await db
    .update(characterMissions)
    .set({ completedAt: new Date() })
    .where(eq(characterMissions.characterId, characterId));
  await page.reload();
  const unlocked = await openNpcConversation(page, "Tansy Rusk");
  const unlockedTopics = unlocked
    .locator('[data-conversation-section="topics"]')
    .getByRole("button");
  await expect(unlockedTopics).toHaveCount(2);
  await openConversationEntry(unlocked, /Beyond Holo Hollow/);
  await expect(unlocked.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "What's it like out there?",
  );
  await expect(unlocked.locator("[data-dialogue-action]")).toHaveCount(0);
  await unlocked.getByRole("button", { name: "Next" }).click();
  await expect(unlocked.locator('[data-dialogue-text] [aria-hidden="true"]')).toContainText(
    "You used to run deliveries",
  );
});
