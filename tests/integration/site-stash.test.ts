import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  getRepairTargetBalance,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
  type RepairTargetId,
} from "@/game/config/foundations";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  installedMaterials,
  seedRepairTarget,
} from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("issue #284 character-owned site stashes (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let stash: typeof import("@/server/site-stash");
  let repairs: typeof import("@/server/repair-commands");
  let cargo: typeof import("@/server/cargo-hold");
  let equipment: typeof import("@/server/equipment");
  const createdUsers: string[] = [];
  const balance = getEffectiveGameBalance();
  const random = { nextBasisPoints: () => 0, nextUnit: () => 0 };
  const now = new Date("2026-10-01T18:00:00.000Z");
  const SECTION_MS = balance.welding.attemptDurationTicks * 600;

  const SITES = {
    theJag: { location: LOCATION_IDS.theJag, target: REPAIR_TARGET_IDS.siteStashTheJag },
    rusk: { location: LOCATION_IDS.ruskRecovery, target: REPAIR_TARGET_IDS.siteStashRuskRecovery },
    yard: {
      location: LOCATION_IDS.abandonedProcessingYard,
      target: REPAIR_TARGET_IDS.siteStashProcessingYard,
    },
    deepJag: { location: LOCATION_IDS.deepJag, target: REPAIR_TARGET_IDS.siteStashDeepJag },
  } as const;

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    stash = await import("@/server/site-stash");
    repairs = await import("@/server/repair-commands");
    cargo = await import("@/server/cargo-hold");
    equipment = await import("@/server/equipment");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter(label = "Stash") {
    const userId = await createTestUser(db, authSchema, `${label} Tester`);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `${label} ${userId.slice(0, 8)}`,
    );
    await play.getPlayGameplayState(userId, character.id, now, random);
    return { userId, characterId: character.id };
  }

  const state = (userId: string, characterId: string, at = now) =>
    play.getPlayGameplayState(userId, characterId, at, random);

  async function moveTo(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  /** Put Welding exactly on a level's authored threshold. */
  async function setWelding(characterId: string, level: number) {
    const totalXp = standardSkillLevelThresholds(balance).find(
      (threshold) => threshold.level === level,
    )!.totalXp;
    await db
      .insert(rune.characterSkillXp)
      .values({ characterId, skillId: SKILL_IDS.welding, totalXp })
      .onConflictDoUpdate({
        target: [rune.characterSkillXp.characterId, rune.characterSkillXp.skillId],
        set: { totalXp },
      });
  }

  async function weldingXp(characterId: string) {
    const rows = await db
      .select({ totalXp: rune.characterSkillXp.totalXp })
      .from(rune.characterSkillXp)
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.welding),
        ),
      );
    return rows[0]?.totalXp ?? 0;
  }

  async function giveStack(characterId: string, itemId: string, quantity: number) {
    const definition = getItemDefinition(itemId);
    const stackLimit = definition?.kind === "stack" ? definition.stackLimit : quantity;
    let remaining = quantity;
    const ids: string[] = [];
    while (remaining > 0) {
      const part = Math.min(stackLimit, remaining);
      const [row] = await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId, quantity: part })
        .returning();
      ids.push(row!.id);
      remaining -= part;
    }
    return ids;
  }

  async function giveInstance(characterId: string, itemId: string, currentCharge?: number) {
    const [row] = await db
      .insert(rune.itemInstances)
      .values({ characterId, itemId, ...(currentCharge !== undefined ? { currentCharge } : {}) })
      .returning();
    return row!;
  }

  /** The mount already built, as a finished Welding job would leave it. */
  async function buildMount(characterId: string, targetId: RepairTargetId) {
    const recipe = getRepairTargetBalance(targetId, balance);
    await seedRepairTarget(db, rune, characterId, targetId, {
      materials: installedMaterials(recipe),
      weldingProgress: recipe.repairIncrements,
      completedAt: now,
      updatedAt: now,
    });
  }

  async function equippedContainerId(characterId: string) {
    const [row] = await db
      .select({ id: rune.equippedItems.itemInstanceId })
      .from(rune.equippedItems)
      .where(
        and(
          eq(rune.equippedItems.characterId, characterId),
          eq(rune.equippedItems.assignmentKind, "container"),
        ),
      );
    return row!.id;
  }

  async function equippedCutterId(characterId: string) {
    const [row] = await db
      .select({ id: rune.equippedItems.itemInstanceId })
      .from(rune.equippedItems)
      .where(
        and(
          eq(rune.equippedItems.characterId, characterId),
          eq(rune.equippedItems.assignmentKind, "gear"),
        ),
      );
    return row!.id;
  }

  /** A character with a built mount at The Jag and the given container installed. */
  async function stashedCharacter(containerItemId: string = ITEM_IDS.scrapBox) {
    const made = await makeCharacter();
    await moveTo(made.characterId, SITES.theJag.location);
    await buildMount(made.characterId, SITES.theJag.target);
    const container = await giveInstance(made.characterId, containerItemId);
    const installed = await stash.installSiteStashContainer(
      made.userId,
      made.characterId,
      { locationId: SITES.theJag.location, itemInstanceId: container.id },
      now,
      random,
    );
    expect(installed.stash).toMatchObject({ status: "committed" });
    return { ...made, container };
  }

  const at = SITES.theJag.location;
  const deposit = (
    made: { userId: string; characterId: string },
    stackId: string,
    quantity: number,
    mode: "one" | "stack" = "stack",
    location: string = at,
  ) =>
    stash.depositSiteStashStack(
      made.userId,
      made.characterId,
      { locationId: location, stackId, mode, expectedQuantity: quantity },
      now,
      random,
    );

  async function stashRows(characterId: string) {
    const [containers, stacks, items] = await Promise.all([
      db
        .select()
        .from(rune.siteStashContainers)
        .where(eq(rune.siteStashContainers.characterId, characterId)),
      db
        .select()
        .from(rune.siteStashStacks)
        .where(eq(rune.siteStashStacks.characterId, characterId)),
      db
        .select()
        .from(rune.siteStashItemInstances)
        .where(eq(rune.siteStashItemInstances.characterId, characterId)),
    ]);
    return { containers, stacks, items };
  }

  describe("progressive location UX and the Welding gate", () => {
    it("shows no stash surface, teaser or control before the personal Welding threshold", async () => {
      const { userId, characterId } = await makeCharacter();
      await moveTo(characterId, SITES.rusk.location);
      await setWelding(characterId, 4);
      const before = await state(userId, characterId);
      expect(before.siteStash).toBeUndefined();

      // The server is the authority, not the hidden surface.
      const recipe = getRepairTargetBalance(SITES.rusk.target, balance);
      await giveStack(characterId, ITEM_IDS.galvanicStock, 3);
      await giveStack(characterId, ITEM_IDS.mountingBracket, 2);
      const refused = await repairs.contributeRepairMaterials(
        userId,
        characterId,
        {
          targetId: SITES.rusk.target,
          expectedMaterials: Object.fromEntries(
            recipe.materials.map((material) => [material.itemId, material.quantity]),
          ),
        },
        now,
        random,
      );
      expect(refused.repair).toMatchObject({ status: "refused", reason: "repair_locked" });

      await setWelding(characterId, 5);
      const after = await state(userId, characterId);
      expect(after.siteStash).toMatchObject({
        locationId: SITES.rusk.location,
        mountBuilt: false,
        repair: { repairAvailable: true, complete: false },
      });
    });

    it("keeps Deep Jag hidden until the passage is open, even at Welding 8", async () => {
      const { userId, characterId } = await makeCharacter();
      await moveTo(characterId, SITES.deepJag.location);
      await setWelding(characterId, 8);
      expect((await state(userId, characterId)).siteStash).toBeUndefined();

      const caveIn = getRepairTargetBalance(REPAIR_TARGET_IDS.deepJagCaveIn, balance);
      await seedRepairTarget(db, rune, characterId, REPAIR_TARGET_IDS.deepJagCaveIn, {
        materials: installedMaterials(caveIn),
        weldingProgress: caveIn.repairIncrements,
        completedAt: now,
        updatedAt: now,
      });
      expect((await state(userId, characterId)).siteStash?.repair.repairAvailable).toBe(true);
    });

    it("keeps a built mount visible and usable even if the level gate no longer applies", async () => {
      const { userId, characterId } = await makeCharacter();
      await moveTo(characterId, SITES.yard.location);
      await buildMount(characterId, SITES.yard.target);
      expect((await state(userId, characterId)).siteStash).toMatchObject({ mountBuilt: true });
    });
  });

  describe("constructing a mount reuses the ordinary Welding flow", () => {
    it("builds The Jag's mount: 6 Refined Ferrite + 3 Slag, six sections, 300 Welding XP", async () => {
      const { userId, characterId } = await makeCharacter();
      await moveTo(characterId, SITES.theJag.location);
      await giveStack(characterId, ITEM_IDS.refinedFerrite, 6);
      await giveStack(characterId, ITEM_IDS.slag, 3);
      const xpBefore = await weldingXp(characterId);

      const contributed = await repairs.contributeRepairMaterials(
        userId,
        characterId,
        {
          targetId: SITES.theJag.target,
          expectedMaterials: { [ITEM_IDS.refinedFerrite]: 6, [ITEM_IDS.slag]: 3 },
        },
        now,
        random,
      );
      expect(contributed.repair).toMatchObject({ status: "committed" });
      expect(contributed.state.siteStash?.repair.materialComplete).toBe(true);
      // Contributed material is spent from carried Inventory for good.
      expect(contributed.state.inventory.stacks).toEqual([]);

      const started = await repairs.startWelding(
        userId,
        characterId,
        SITES.theJag.target,
        now,
        random,
      );
      expect(started.activeAction?.actionId).toBe(ACTION_IDS.siteStashTheJagWelding);

      const sections = getRepairTargetBalance(SITES.theJag.target, balance).repairIncrements;
      expect(sections).toBe(6);
      const done = await state(
        userId,
        characterId,
        new Date(now.getTime() + sections * SECTION_MS),
      );
      expect(done.siteStash).toMatchObject({ mountBuilt: true });
      expect(done.activeAction).toBeUndefined();
      expect(await weldingXp(characterId)).toBe(xpBefore + 300);

      // Completion is permanent and repeatable at no other site.
      const again = await repairs.contributeRepairMaterials(
        userId,
        characterId,
        { targetId: SITES.theJag.target, expectedMaterials: {} },
        now,
        random,
      );
      expect(again.repair).toMatchObject({ status: "refused" });
    });

    it("authors identical recipes for both Tier 2 sites and distinct durable state per site", async () => {
      const rusk = getRepairTargetBalance(SITES.rusk.target, balance);
      const yard = getRepairTargetBalance(SITES.yard.target, balance);
      expect(rusk.materials).toEqual(yard.materials);
      expect(rusk.repairIncrements).toBe(yard.repairIncrements);
      expect(rusk.repairIncrements).toBe(10);

      const { userId, characterId } = await makeCharacter();
      await setWelding(characterId, 5);
      await moveTo(characterId, SITES.yard.location);
      await giveStack(characterId, ITEM_IDS.galvanicStock, 3);
      await giveStack(characterId, ITEM_IDS.mountingBracket, 2);
      const contributed = await repairs.contributeRepairMaterials(
        userId,
        characterId,
        {
          targetId: SITES.yard.target,
          expectedMaterials: {
            [ITEM_IDS.galvanicStock]: 3,
            [ITEM_IDS.mountingBracket]: 2,
          },
        },
        now,
        random,
      );
      expect(contributed.repair).toMatchObject({ status: "committed" });
      // Rusk's mount is a different row and is untouched by the Yard's.
      const rows = await db
        .select({ targetId: rune.characterRepairTargets.targetId })
        .from(rune.characterRepairTargets)
        .where(eq(rune.characterRepairTargets.characterId, characterId));
      expect(rows.map((row) => row.targetId)).toEqual([SITES.yard.target]);
    });

    it("refuses to contribute to a mount from the wrong location", async () => {
      const { userId, characterId } = await makeCharacter();
      await moveTo(characterId, SITES.theJag.location);
      await setWelding(characterId, 5);
      await giveStack(characterId, ITEM_IDS.galvanicStock, 3);
      await giveStack(characterId, ITEM_IDS.mountingBracket, 2);
      const refused = await repairs.contributeRepairMaterials(
        userId,
        characterId,
        {
          targetId: SITES.rusk.target,
          expectedMaterials: {
            [ITEM_IDS.galvanicStock]: 3,
            [ITEM_IDS.mountingBracket]: 2,
          },
        },
        now,
        random,
      );
      expect(refused.repair).toMatchObject({ status: "refused", reason: "wrong_location" });
    });
  });

  describe("installing a container", () => {
    it("refuses every stash command before the mount is built", async () => {
      const { userId, characterId } = await makeCharacter();
      await moveTo(characterId, at);
      const container = await giveInstance(characterId, ITEM_IDS.scrapBox);
      const [stack] = await giveStack(characterId, ITEM_IDS.slag, 2);
      const fake = "00000000-0000-4000-8000-000000000000";
      const refused = await Promise.all([
        stash.installSiteStashContainer(
          userId,
          characterId,
          { locationId: at, itemInstanceId: container.id },
          now,
          random,
        ),
        stash.removeSiteStashContainer(
          userId,
          characterId,
          { locationId: at, expectedContainerInstanceId: fake },
          now,
          random,
        ),
        stash.swapSiteStashContainer(
          userId,
          characterId,
          { locationId: at, expectedContainerInstanceId: fake, itemInstanceId: container.id },
          now,
          random,
        ),
        stash.depositSiteStashStack(
          userId,
          characterId,
          { locationId: at, stackId: stack!, mode: "stack", expectedQuantity: 2 },
          now,
          random,
        ),
        stash.withdrawSiteStashStack(
          userId,
          characterId,
          { locationId: at, stackId: fake, mode: "stack", expectedQuantity: 1 },
          now,
          random,
        ),
        stash.depositSiteStashUniqueItem(
          userId,
          characterId,
          { locationId: at, itemInstanceId: container.id },
          now,
          random,
        ),
        stash.withdrawSiteStashUniqueItem(
          userId,
          characterId,
          { locationId: at, itemInstanceId: fake },
          now,
          random,
        ),
      ]);
      for (const result of refused)
        expect(result.stash).toMatchObject({ status: "refused", reason: "mount_not_built" });
      const rows = await stashRows(characterId);
      expect(rows.containers).toEqual([]);
      expect(rows.stacks).toEqual([]);
      expect(rows.items).toEqual([]);
    });

    it("installs any ordinary container; it leaves carried availability and capacity equals its own", async () => {
      for (const [itemId, capacity] of [
        [ITEM_IDS.scrapBox, 3],
        [ITEM_IDS.freightHarness, 6],
        [ITEM_IDS.mykeaSchleppraum8, 8],
      ] as const) {
        const made = await makeCharacter(`Install ${capacity}`);
        await moveTo(made.characterId, at);
        await buildMount(made.characterId, SITES.theJag.target);
        const container = await giveInstance(made.characterId, itemId);
        const before = await state(made.userId, made.characterId);
        expect(before.inventory.uniqueItems.map((item) => item.id)).toContain(container.id);

        const result = await stash.installSiteStashContainer(
          made.userId,
          made.characterId,
          { locationId: at, itemInstanceId: container.id },
          now,
          random,
        );
        expect(result.stash).toMatchObject({ status: "committed", itemInstanceId: container.id });
        expect(result.state.siteStash).toMatchObject({
          mountBuilt: true,
          capacitySlots: capacity,
          container: { itemInstanceId: container.id, itemId, slotCapacity: capacity },
        });
        // No ghost capacity: it is neither carried nor equipped any more.
        expect(result.state.inventory.uniqueItems.map((item) => item.id)).not.toContain(
          container.id,
        );
        expect(result.state.inventory.slotsUsed).toBe(before.inventory.slotsUsed - 1);
        expect(result.state.inventory.massGrams).toBe(
          before.inventory.massGrams -
            (itemId === ITEM_IDS.scrapBox
              ? 5000
              : itemId === ITEM_IDS.freightHarness
                ? 9000
                : 10000),
        );
      }
    });

    it("refuses an equipped, foreign, non-container or already-placed item", async () => {
      const a = await makeCharacter("Owner");
      const b = await makeCharacter("Other");
      await moveTo(a.characterId, at);
      await buildMount(a.characterId, SITES.theJag.target);
      const install = (itemInstanceId: string) =>
        stash.installSiteStashContainer(
          a.userId,
          a.characterId,
          { locationId: at, itemInstanceId },
          now,
          random,
        );

      expect((await install(await equippedContainerId(a.characterId))).stash).toMatchObject({
        reason: "equipped_item",
      });
      const foreign = await giveInstance(b.characterId, ITEM_IDS.scrapBox);
      expect((await install(foreign.id)).stash).toMatchObject({ reason: "item_not_found" });
      const notAContainer = await giveInstance(a.characterId, ITEM_IDS.salvageCutter, 3);
      expect((await install(notAContainer.id)).stash).toMatchObject({ reason: "not_a_container" });

      // Already in Cargo: owned but not carried.
      const stored = await giveInstance(a.characterId, ITEM_IDS.scrapBox);
      await db
        .insert(rune.cargoHoldItemInstances)
        .values({ characterId: a.characterId, itemInstanceId: stored.id });
      expect((await install(stored.id)).stash).toMatchObject({ reason: "item_unavailable" });
      expect((await stashRows(a.characterId)).containers).toEqual([]);
    });

    it("refuses a second container at a mount that already has one", async () => {
      const made = await stashedCharacter();
      const second = await giveInstance(made.characterId, ITEM_IDS.freightHarness);
      const refused = await stash.installSiteStashContainer(
        made.userId,
        made.characterId,
        { locationId: at, itemInstanceId: second.id },
        now,
        random,
      );
      expect(refused.stash).toMatchObject({ status: "refused", reason: "container_present" });
    });
  });

  describe("depositing and withdrawing", () => {
    it("moves stacks both ways exactly, bounded only by the container's slots", async () => {
      const made = await stashedCharacter(); // Scrap Box: 3 slots
      const [stackA] = await giveStack(made.characterId, ITEM_IDS.ferriteShale, 10);
      const [stackB] = await giveStack(made.characterId, ITEM_IDS.slag, 4);
      const [stackC] = await giveStack(made.characterId, ITEM_IDS.refinedFerrite, 5);
      const [stackD] = await giveStack(made.characterId, ITEM_IDS.powerCell, 2);

      expect((await deposit(made, stackA!, 10, "one")).stash).toMatchObject({
        status: "committed",
        quantity: 1,
      });
      const rest = await deposit(made, stackA!, 9);
      expect(rest.stash).toMatchObject({ status: "committed", quantity: 9 });
      expect(rest.state.siteStash?.stacks).toEqual([
        expect.objectContaining({ itemId: ITEM_IDS.ferriteShale, quantity: 10 }),
      ]);
      await deposit(made, stackB!, 4);
      await deposit(made, stackC!, 5);
      expect((await state(made.userId, made.characterId)).siteStash?.slotsUsed).toBe(3);

      const full = await deposit(made, stackD!, 2);
      expect(full.stash).toMatchObject({ status: "refused", reason: "stash_capacity" });
      // A refusal changes nothing: the stack is still carried in full.
      expect(full.state.inventory.stacks.find((stack) => stack.id === stackD)?.quantity).toBe(2);

      const stored = (await state(made.userId, made.characterId)).siteStash!.stacks;
      const withdrawn = await stash.withdrawSiteStashStack(
        made.userId,
        made.characterId,
        {
          locationId: at,
          stackId: stored.find((stack) => stack.itemId === ITEM_IDS.slag)!.id,
          mode: "one",
          expectedQuantity: 4,
        },
        now,
        random,
      );
      expect(withdrawn.stash).toMatchObject({ status: "committed", quantity: 1 });
      expect(
        withdrawn.state.inventory.stacks.find((s) => s.itemId === ITEM_IDS.slag),
      ).toBeDefined();
    });

    it("keeps unique identity and mutable state through a round trip", async () => {
      const made = await stashedCharacter();
      const cutter = await giveInstance(made.characterId, ITEM_IDS.salvageCutter, 7);
      const stored = await stash.depositSiteStashUniqueItem(
        made.userId,
        made.characterId,
        { locationId: at, itemInstanceId: cutter.id },
        now,
        random,
      );
      expect(stored.stash).toMatchObject({ status: "committed", itemInstanceId: cutter.id });
      expect(stored.state.siteStash?.uniqueItems).toEqual([
        expect.objectContaining({ id: cutter.id, currentCharge: 7 }),
      ]);
      expect(stored.state.inventory.uniqueItems.map((item) => item.id)).not.toContain(cutter.id);

      const back = await stash.withdrawSiteStashUniqueItem(
        made.userId,
        made.characterId,
        { locationId: at, itemInstanceId: cutter.id },
        now,
        random,
      );
      expect(back.stash).toMatchObject({ status: "committed" });
      expect(back.state.inventory.uniqueItems).toContainEqual(
        expect.objectContaining({ id: cutter.id, currentCharge: 7 }),
      );
      expect((await stashRows(made.characterId)).items).toEqual([]);
    });

    it("refuses an equipped item, a stale stack, and a withdrawal that does not fit carried Inventory", async () => {
      const made = await stashedCharacter(ITEM_IDS.mykeaSchleppraum8);
      const equipped = await stash.depositSiteStashUniqueItem(
        made.userId,
        made.characterId,
        { locationId: at, itemInstanceId: await equippedCutterId(made.characterId) },
        now,
        random,
      );
      expect(equipped.stash).toMatchObject({ reason: "equipped_item" });

      const [stack] = await giveStack(made.characterId, ITEM_IDS.slag, 5);
      expect((await deposit(made, stack!, 3)).stash).toMatchObject({ reason: "stack_changed" });
      expect((await deposit(made, "00000000-0000-4000-8000-000000000000", 1)).stash).toMatchObject({
        reason: "stack_not_found",
      });

      await deposit(made, stack!, 5);
      // Fill every carried slot, then a complete withdrawal cannot fit.
      const view = await state(made.userId, made.characterId);
      for (let slot = 0; slot < view.inventory.slotsAvailable; slot += 1)
        await giveStack(made.characterId, ITEM_IDS.ferriteShale, 1);
      const storedId = (await state(made.userId, made.characterId)).siteStash!.stacks[0]!.id;
      const refused = await stash.withdrawSiteStashStack(
        made.userId,
        made.characterId,
        { locationId: at, stackId: storedId, mode: "stack", expectedQuantity: 5 },
        now,
        random,
      );
      expect(refused.stash).toMatchObject({ status: "refused", reason: "carried_capacity" });
      expect((await stashRows(made.characterId)).stacks).toHaveLength(1);
    });

    it("lets a stash hold more mass than a character may carry", async () => {
      const made = await stashedCharacter(ITEM_IDS.mykeaSchleppraum8); // 8 slots
      const stacks = await giveStack(made.characterId, ITEM_IDS.galvanicStock, 25); // 5 x 4 kg
      for (const id of stacks) await deposit(made, id, 5);
      const stored = (await state(made.userId, made.characterId)).siteStash!;
      expect(stored.stacks.reduce((sum, stack) => sum + stack.quantity, 0)).toBe(25);
    });

    it("only works at that stash's own site, and keeps sites isolated", async () => {
      const made = await stashedCharacter();
      const [stack] = await giveStack(made.characterId, ITEM_IDS.slag, 2);
      await deposit(made, stack!, 2);

      // Elsewhere, with a built mount of its own and nothing stored.
      await moveTo(made.characterId, SITES.yard.location);
      await buildMount(made.characterId, SITES.yard.target);
      const away = await state(made.userId, made.characterId);
      expect(away.siteStash).toMatchObject({ locationId: SITES.yard.location, slotsUsed: 0 });
      const wrongSite = await stash.withdrawSiteStashStack(
        made.userId,
        made.characterId,
        {
          locationId: at,
          stackId: (await stashRows(made.characterId)).stacks[0]!.id,
          mode: "stack",
          expectedQuantity: 2,
        },
        now,
        random,
      );
      expect(wrongSite.stash).toMatchObject({ status: "refused", reason: "not_at_site" });
      const noContainer = await deposit(made, stack!, 1, "one", SITES.yard.location);
      // The Yard mount is built but has no container yet, so that is what refuses.
      expect(noContainer.stash).toMatchObject({ reason: "no_container" });
    });

    it("refuses while an activity is running", async () => {
      const made = await stashedCharacter();
      const [stack] = await giveStack(made.characterId, ITEM_IDS.slag, 2);
      await db.insert(rune.activeActions).values({
        characterId: made.characterId,
        actionId: ACTION_IDS.ferriteShaleMining,
        startedAt: now,
        resolvedThroughAt: now,
      });
      expect((await deposit(made, stack!, 2)).stash).toMatchObject({
        status: "refused",
        reason: "in_transit",
      });
    });
  });

  describe("authority and isolation between characters", () => {
    it("cannot be driven by another account's character id", async () => {
      const owner = await stashedCharacter();
      const intruder = await makeCharacter("Intruder");
      const [stack] = await giveStack(owner.characterId, ITEM_IDS.slag, 2);
      await expect(
        stash.depositSiteStashStack(
          intruder.userId,
          owner.characterId,
          { locationId: at, stackId: stack!, mode: "stack", expectedQuantity: 2 },
          now,
          random,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect((await stashRows(owner.characterId)).stacks).toEqual([]);
    });

    it("gives two characters independent mounts, containers and contents at the same site", async () => {
      const first = await stashedCharacter();
      const second = await stashedCharacter(ITEM_IDS.freightHarness);
      const [stack] = await giveStack(first.characterId, ITEM_IDS.slag, 2);
      await deposit(first, stack!, 2);
      expect((await state(second.userId, second.characterId)).siteStash).toMatchObject({
        capacitySlots: 6,
        slotsUsed: 0,
      });
      expect((await stashRows(second.characterId)).stacks).toEqual([]);
    });

    it("never lets a stashed or installed item be moved to the Cargo Hold or equipped", async () => {
      const made = await stashedCharacter();
      const cutter = await giveInstance(made.characterId, ITEM_IDS.salvageCutter, 4);
      await stash.depositSiteStashUniqueItem(
        made.userId,
        made.characterId,
        { locationId: at, itemInstanceId: cutter.id },
        now,
        random,
      );
      await moveTo(made.characterId, LOCATION_IDS.crashSite);
      await seedRepairTarget(db, rune, made.characterId, REPAIR_TARGET_IDS.cargoHold, {
        materials: installedMaterials(getRepairTargetBalance(REPAIR_TARGET_IDS.cargoHold, balance)),
        weldingProgress: 12,
        completedAt: now,
        updatedAt: now,
      });
      for (const itemInstanceId of [cutter.id, made.container.id]) {
        const result = await cargo.depositCargoUniqueItem(
          made.userId,
          made.characterId,
          { itemInstanceId },
          now,
          random,
        );
        expect(result.cargo).toMatchObject({ status: "refused", reason: "item_in_site_stash" });
      }
      expect(
        (
          await db
            .select()
            .from(rune.cargoHoldItemInstances)
            .where(eq(rune.cargoHoldItemInstances.characterId, made.characterId))
        ).length,
      ).toBe(0);

      // The installed container is not a carried item to equip either.
      await expect(
        equipment.changeEquipment(
          made.userId,
          made.characterId,
          {
            kind: "equip",
            itemInstanceId: made.container.id,
            target: { assignmentKind: "container", suitSlotId: "container_attachment_2" },
          },
          now,
          random,
        ),
      ).rejects.toThrow(/not currently carried/);
      expect((await stashRows(made.characterId)).containers).toHaveLength(1);
    });
  });

  describe("removing and swapping the container", () => {
    it("removes a container only from a completely empty stash, and the mount stays built", async () => {
      const made = await stashedCharacter();
      const [stack] = await giveStack(made.characterId, ITEM_IDS.slag, 2);
      await deposit(made, stack!, 2);
      const remove = () =>
        stash.removeSiteStashContainer(
          made.userId,
          made.characterId,
          { locationId: at, expectedContainerInstanceId: made.container.id },
          now,
          random,
        );
      expect((await state(made.userId, made.characterId)).siteStash?.removeBlockedReason).toBe(
        "not_empty",
      );
      expect((await remove()).stash).toMatchObject({ status: "refused", reason: "not_empty" });
      expect((await stashRows(made.characterId)).containers).toHaveLength(1);

      const storedId = (await stashRows(made.characterId)).stacks[0]!.id;
      await stash.withdrawSiteStashStack(
        made.userId,
        made.characterId,
        { locationId: at, stackId: storedId, mode: "stack", expectedQuantity: 2 },
        now,
        random,
      );
      const removed = await remove();
      expect(removed.stash).toMatchObject({ status: "committed" });
      expect(removed.state.siteStash).toMatchObject({ mountBuilt: true, capacitySlots: 0 });
      expect(removed.state.siteStash?.container).toBeUndefined();
      expect(removed.state.siteStash?.removeBlockedReason).toBeUndefined();
      // The container is carried again, by the same instance.
      expect(removed.state.inventory.uniqueItems.map((item) => item.id)).toContain(
        made.container.id,
      );
      expect((await stashRows(made.characterId)).containers).toEqual([]);
    });

    it("refuses removal that would not fit carried Inventory, leaving everything unchanged", async () => {
      const made = await stashedCharacter(ITEM_IDS.mykeaSchleppraum8);
      const view = await state(made.userId, made.characterId);
      for (let slot = 0; slot < view.inventory.slotsAvailable; slot += 1)
        await giveStack(made.characterId, ITEM_IDS.ferriteShale, 1);
      const refused = await stash.removeSiteStashContainer(
        made.userId,
        made.characterId,
        { locationId: at, expectedContainerInstanceId: made.container.id },
        now,
        random,
      );
      expect(refused.stash).toMatchObject({ status: "refused", reason: "carried_capacity" });
      expect(refused.state.siteStash?.removeBlockedReason).toBe("carried_capacity");
      expect((await stashRows(made.characterId)).containers).toHaveLength(1);
    });

    it("swaps in a different container type atomically without moving stored contents", async () => {
      const made = await stashedCharacter(ITEM_IDS.scrapBox); // 3 slots
      const stacks = [
        ...(await giveStack(made.characterId, ITEM_IDS.slag, 1)),
        ...(await giveStack(made.characterId, ITEM_IDS.refinedFerrite, 1)),
      ];
      for (const id of stacks) await deposit(made, id, 1);
      const cutter = await giveInstance(made.characterId, ITEM_IDS.salvageCutter, 6);
      await stash.depositSiteStashUniqueItem(
        made.userId,
        made.characterId,
        { locationId: at, itemInstanceId: cutter.id },
        now,
        random,
      );
      const rowsBefore = await stashRows(made.characterId);
      const harness = await giveInstance(made.characterId, ITEM_IDS.freightHarness);

      const swapped = await stash.swapSiteStashContainer(
        made.userId,
        made.characterId,
        {
          locationId: at,
          expectedContainerInstanceId: made.container.id,
          itemInstanceId: harness.id,
        },
        now,
        random,
      );
      expect(swapped.stash).toMatchObject({ status: "committed" });
      expect(swapped.state.siteStash).toMatchObject({
        capacitySlots: 6,
        slotsUsed: 3,
        container: { itemInstanceId: harness.id },
      });
      const rowsAfter = await stashRows(made.characterId);
      expect(rowsAfter.stacks).toEqual(rowsBefore.stacks);
      expect(rowsAfter.items).toEqual(rowsBefore.items);
      expect(rowsAfter.containers[0]?.itemInstanceId).toBe(harness.id);
      // The old container is carried again; the replacement is not.
      const carried = swapped.state.inventory.uniqueItems.map((item) => item.id);
      expect(carried).toContain(made.container.id);
      expect(carried).not.toContain(harness.id);
    });

    it("allows a swap whose capacity exactly equals the occupied slots, heavy to light", async () => {
      const made = await stashedCharacter(ITEM_IDS.freightHarness); // 9 kg, 6 slots
      const ids = [
        ...(await giveStack(made.characterId, ITEM_IDS.slag, 1)),
        ...(await giveStack(made.characterId, ITEM_IDS.refinedFerrite, 1)),
        ...(await giveStack(made.characterId, ITEM_IDS.powerCell, 1)),
      ];
      for (const id of ids) await deposit(made, id, 1);
      const box = await giveInstance(made.characterId, ITEM_IDS.scrapBox); // 5 kg, 3 slots
      const swapped = await stash.swapSiteStashContainer(
        made.userId,
        made.characterId,
        {
          locationId: at,
          expectedContainerInstanceId: made.container.id,
          itemInstanceId: box.id,
        },
        now,
        random,
      );
      expect(swapped.stash).toMatchObject({ status: "committed" });
      expect(swapped.state.siteStash).toMatchObject({ capacitySlots: 3, slotsUsed: 3 });
    });

    it("rejects the same container type, an undersized replacement, equipped, foreign and stale swaps", async () => {
      const made = await stashedCharacter(ITEM_IDS.freightHarness); // 6 slots
      const swap = (itemInstanceId: string, expected = made.container.id) =>
        stash.swapSiteStashContainer(
          made.userId,
          made.characterId,
          { locationId: at, expectedContainerInstanceId: expected, itemInstanceId },
          now,
          random,
        );
      const sameType = await giveInstance(made.characterId, ITEM_IDS.freightHarness);
      expect((await swap(sameType.id)).stash).toMatchObject({ reason: "same_container_type" });

      // Four occupied slots do not fit a three-slot Scrap Box. Distinct items,
      // because identical ones would merge into a single slot.
      for (const itemId of [
        ITEM_IDS.slag,
        ITEM_IDS.refinedFerrite,
        ITEM_IDS.powerCell,
        ITEM_IDS.ferriteShale,
      ]) {
        const [id] = await giveStack(made.characterId, itemId, 1);
        await deposit(made, id!, 1);
      }
      expect((await stashRows(made.characterId)).stacks).toHaveLength(4);
      const small = await giveInstance(made.characterId, ITEM_IDS.scrapBox);
      expect((await swap(small.id)).stash).toMatchObject({ reason: "stash_capacity" });

      expect((await swap(await equippedContainerId(made.characterId))).stash).toMatchObject({
        reason: "equipped_item",
      });
      const other = await makeCharacter("Other");
      const foreign = await giveInstance(other.characterId, ITEM_IDS.mykeaSchleppraum8);
      expect((await swap(foreign.id)).stash).toMatchObject({ reason: "item_not_found" });
      const large = await giveInstance(made.characterId, ITEM_IDS.mykeaSchleppraum8);
      expect((await swap(large.id, small.id)).stash).toMatchObject({ reason: "container_changed" });
      expect((await swap(sameType.id, made.container.id)).stash).toMatchObject({
        reason: "same_container_type",
      });
      expect((await stashRows(made.characterId)).containers[0]?.itemInstanceId).toBe(
        made.container.id,
      );
      expect((await stashRows(made.characterId)).stacks).toHaveLength(4);
    });

    it("refuses a swap whose returned container would not fit carried mass, changing nothing", async () => {
      const made = await stashedCharacter(ITEM_IDS.freightHarness); // returns 9 kg
      const box = await giveInstance(made.characterId, ITEM_IDS.scrapBox); // 5 kg consumed
      // Carried: Cutter 5 + MYKEA 10 + Scrap Box 5 = 20 kg; add seven 4 kg stacks.
      await giveStack(made.characterId, ITEM_IDS.galvanicStock, 35);
      const view = await state(made.userId, made.characterId);
      expect(view.inventory.massGrams).toBe(48_000);
      const refused = await stash.swapSiteStashContainer(
        made.userId,
        made.characterId,
        {
          locationId: at,
          expectedContainerInstanceId: made.container.id,
          itemInstanceId: box.id,
        },
        now,
        random,
      );
      expect(refused.stash).toMatchObject({ status: "refused", reason: "carried_capacity" });
      expect((await stashRows(made.characterId)).containers[0]?.itemInstanceId).toBe(
        made.container.id,
      );
      expect(refused.state.siteStash?.swappableContainerInstanceIds).toEqual([]);
    });
  });

  describe("concurrent commands", () => {
    it("never duplicates or loses a stack when the same deposit is raced", async () => {
      const made = await stashedCharacter();
      const [stack] = await giveStack(made.characterId, ITEM_IDS.slag, 6);
      const results = await Promise.all(Array.from({ length: 4 }, () => deposit(made, stack!, 6)));
      expect(results.filter((result) => result.stash.status === "committed")).toHaveLength(1);
      const rows = await stashRows(made.characterId);
      expect(rows.stacks.reduce((sum, row) => sum + row.quantity, 0)).toBe(6);
      const carried = await db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, made.characterId));
      expect(carried.find((row) => row.itemId === ITEM_IDS.slag)).toBeUndefined();
    });

    it("installs exactly one container when two installs are raced", async () => {
      const made = await makeCharacter();
      await moveTo(made.characterId, at);
      await buildMount(made.characterId, SITES.theJag.target);
      const a = await giveInstance(made.characterId, ITEM_IDS.scrapBox);
      const b = await giveInstance(made.characterId, ITEM_IDS.freightHarness);
      const results = await Promise.all(
        [a, b].map((container) =>
          stash.installSiteStashContainer(
            made.userId,
            made.characterId,
            { locationId: at, itemInstanceId: container.id },
            now,
            random,
          ),
        ),
      );
      expect(results.filter((result) => result.stash.status === "committed")).toHaveLength(1);
      expect((await stashRows(made.characterId)).containers).toHaveLength(1);
    });

    it("never strands contents when a swap races deposits into the container being replaced", async () => {
      const made = await stashedCharacter(ITEM_IDS.freightHarness); // 6 slots
      const box = await giveInstance(made.characterId, ITEM_IDS.scrapBox); // 3 slots
      const ids = await Promise.all(
        [ITEM_IDS.slag, ITEM_IDS.refinedFerrite, ITEM_IDS.powerCell, ITEM_IDS.ferriteShale].map(
          async (itemId) => (await giveStack(made.characterId, itemId, 1))[0]!,
        ),
      );
      await Promise.all([
        stash.swapSiteStashContainer(
          made.userId,
          made.characterId,
          {
            locationId: at,
            expectedContainerInstanceId: made.container.id,
            itemInstanceId: box.id,
          },
          now,
          random,
        ),
        ...ids.map((id) => deposit(made, id, 1)),
      ]);
      // Whatever order they serialized in, the final stash fits its container
      // and no carried item vanished or doubled.
      const rows = await stashRows(made.characterId);
      const finalContainer = rows.containers[0]!;
      const capacity = finalContainer.itemInstanceId === box.id ? 3 : 6;
      expect(rows.stacks.length + rows.items.length).toBeLessThanOrEqual(capacity);
      const carried = await db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, made.characterId));
      expect(rows.stacks.length + carried.length).toBe(4);
    });

    it("never removes a container out from under a racing deposit", async () => {
      const made = await stashedCharacter();
      const [stack] = await giveStack(made.characterId, ITEM_IDS.slag, 2);
      await Promise.all([
        stash.removeSiteStashContainer(
          made.userId,
          made.characterId,
          { locationId: at, expectedContainerInstanceId: made.container.id },
          now,
          random,
        ),
        deposit(made, stack!, 2),
      ]);
      const rows = await stashRows(made.characterId);
      // Either the deposit won (container stays, slag stored) or the removal
      // won (no container, slag still carried). Never contents without a
      // container, and never slag in both places or in neither.
      if (rows.containers.length === 0) {
        expect(rows.stacks).toEqual([]);
        expect(
          (
            await db
              .select()
              .from(rune.inventoryStacks)
              .where(eq(rune.inventoryStacks.characterId, made.characterId))
          ).some((row) => row.itemId === ITEM_IDS.slag),
        ).toBe(true);
      } else {
        expect(rows.stacks.reduce((sum, row) => sum + row.quantity, 0)).toBe(2);
      }
    });

    it("cannot exceed capacity when deposits race for the last slot", async () => {
      const made = await stashedCharacter(); // 3 slots
      const ids = await Promise.all(
        [
          ITEM_IDS.slag,
          ITEM_IDS.refinedFerrite,
          ITEM_IDS.powerCell,
          ITEM_IDS.ferriteShale,
          ITEM_IDS.galvanite,
        ].map(async (itemId) => (await giveStack(made.characterId, itemId, 1))[0]!),
      );
      await Promise.all(ids.map((id) => deposit(made, id, 1)));
      expect((await stashRows(made.characterId)).stacks).toHaveLength(3);
    });
  });

  describe("durability", () => {
    it("survives refresh and travel, and the database refuses to orphan stored contents", async () => {
      const made = await stashedCharacter();
      const [stack] = await giveStack(made.characterId, ITEM_IDS.slag, 2);
      await deposit(made, stack!, 2);
      await moveTo(made.characterId, SITES.yard.location);
      await moveTo(made.characterId, at);
      const refreshed = await state(
        made.userId,
        made.characterId,
        new Date(now.getTime() + 60_000),
      );
      expect(refreshed.siteStash).toMatchObject({ slotsUsed: 1, mountBuilt: true });

      // Defence in depth: the composite FK blocks deleting a non-empty mount.
      await expect(
        db
          .delete(rune.siteStashContainers)
          .where(eq(rune.siteStashContainers.characterId, made.characterId)),
      ).rejects.toThrow();
    });
  });
});
