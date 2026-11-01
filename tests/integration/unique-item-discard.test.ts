import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ITEM_IDS,
  LOCATION_IDS,
  RESEARCH_JOB_IDS,
  SKILL_IDS,
  type LocationId,
} from "@/game/config/foundations";
import { getEffectiveGameBalance, standardSkillLevelThresholds } from "@/game/config/balance";
import type { MiningRandom } from "@/game/domain/mining";
import { OwnershipError } from "@/server/ownership";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("Issue #456 authoritative unique-item discard (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let inventory: typeof import("@/server/inventory");
  let equipment: typeof import("@/server/equipment");
  let miningCommands: typeof import("@/server/mining-commands");
  const createdUsers: string[] = [];
  const balance = getEffectiveGameBalance();
  const containerSlots = balance.carrying.containerSuitSlotIds;
  const now = new Date("2026-11-01T00:00:00.000Z");
  const successYield: MiningRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    inventory = await import("@/server/inventory");
    equipment = await import("@/server/equipment");
    miningCommands = await import("@/server/mining-commands");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  /** A provisioned character wearing the fixture's Salvage Cutter and the starter container. */
  async function makeCharacter() {
    const userId = await createTestUser(db, authSchema, "Unique Discard");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Uniq ${userId.slice(0, 8)}`,
    );
    await play.getPlayGameplayState(userId, character.id, now, successYield);
    const [packRow] = await db
      .select({
        id: rune.equippedItems.itemInstanceId,
        itemId: rune.itemInstances.itemId,
      })
      .from(rune.equippedItems)
      .innerJoin(rune.itemInstances, eq(rune.itemInstances.id, rune.equippedItems.itemInstanceId))
      .where(
        and(
          eq(rune.equippedItems.characterId, character.id),
          eq(rune.equippedItems.assignmentKind, "container"),
        ),
      );
    if (!packRow) throw new Error("Play provisioning should equip a starter container");
    return {
      userId,
      character,
      pack: packRow.id,
      packItemId: packRow.itemId,
      cutter: await equippedCutterOf(character.id),
    };
  }

  async function addInstance(characterId: string, itemId: string, currentCharge?: number) {
    const [row] = await db
      .insert(rune.itemInstances)
      .values({ characterId, itemId, ...(currentCharge === undefined ? {} : { currentCharge }) })
      .returning({ id: rune.itemInstances.id });
    return row!.id;
  }

  async function equippedCutterOf(characterId: string) {
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

  async function exists(instanceId: string) {
    const rows = await db
      .select({ id: rune.itemInstances.id })
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.id, instanceId));
    return rows.length === 1;
  }

  async function instanceCount(characterId: string) {
    return (
      await db
        .select({ id: rune.itemInstances.id })
        .from(rune.itemInstances)
        .where(eq(rune.itemInstances.characterId, characterId))
    ).length;
  }

  async function removeInstance(instanceId: string) {
    await db.delete(rune.equippedItems).where(eq(rune.equippedItems.itemInstanceId, instanceId));
    await db.delete(rune.itemInstances).where(eq(rune.itemInstances.id, instanceId));
  }

  async function setMiningLevel(characterId: string, level: number) {
    const totalXp = standardSkillLevelThresholds(balance)[level - 1]!.totalXp;
    await db
      .update(rune.characterSkillXp)
      .set({ totalXp })
      .where(
        and(
          eq(rune.characterSkillXp.characterId, characterId),
          eq(rune.characterSkillXp.skillId, SKILL_IDS.mining),
        ),
      );
  }

  async function stash(
    characterId: string,
    locationId: LocationId,
    held: string,
    kind: "stored" | "installed" = "stored",
  ) {
    if (kind === "installed") {
      await db.insert(rune.siteStashContainers).values({
        characterId,
        locationId,
        itemInstanceId: held,
      });
      return;
    }
    const container = await addInstance(characterId, ITEM_IDS.scrapBox);
    await db.insert(rune.siteStashContainers).values({
      characterId,
      locationId,
      itemInstanceId: container,
    });
    await db.insert(rune.siteStashItemInstances).values({
      characterId,
      locationId,
      itemInstanceId: held,
    });
  }

  async function discard(
    who: { userId: string; character: { id: string } },
    itemInstanceId: string,
    expectedItemId: string,
    at = now,
  ) {
    return inventory.discardUniqueItem(
      who.userId,
      who.character.id,
      { itemInstanceId, expectedItemId },
      at,
      successYield,
    );
  }

  describe("valid spare items, anywhere, with no Station", () => {
    it.each([
      ["Scrap Box", ITEM_IDS.scrapBox],
      ["MYKEA", ITEM_IDS.mykeaSchleppraum8],
      ["Freight Harness", ITEM_IDS.freightHarness],
      ["Legendary Miner's Boots", ITEM_IDS.minersBoots],
      ["Legendary Miner's Gloves", ITEM_IDS.minersGloves],
    ])("destroys one spare %s and nothing else", async (_name, itemId) => {
      const who = await makeCharacter();
      const spare = await addInstance(who.character.id, itemId);
      const sibling = await addInstance(who.character.id, itemId);
      const before = await instanceCount(who.character.id);

      const result = await discard(who, spare, itemId);

      expect(result.discard).toEqual({ status: "discarded", itemId });
      expect(await exists(spare)).toBe(false);
      expect(await exists(sibling)).toBe(true);
      expect(await exists(who.pack)).toBe(true);
      expect(await exists(who.cutter)).toBe(true);
      expect(await instanceCount(who.character.id)).toBe(before - 1);
      // The returned projection no longer lists the destroyed instance.
      const ids = result.state.inventory.uniqueItems.map((item) => item.id);
      expect(ids).not.toContain(spare);
      expect(ids).toContain(sibling);
    });

    it("destroys a spare charged Cutter while another usable Cutter is equipped", async () => {
      const who = await makeCharacter();
      const spare = await addInstance(who.character.id, ITEM_IDS.salvageCutter, 4);
      const result = await discard(who, spare, ITEM_IDS.salvageCutter);
      expect(result.discard.status).toBe("discarded");
      expect(await exists(spare)).toBe(false);
      expect(await exists(who.cutter)).toBe(true);
    });
  });

  describe("last usable Mining Cutter", () => {
    /** The fixture's equipped Cutter removed, so a carried one is the only. */
    async function onlyCarriedCutter() {
      const who = await makeCharacter();
      await removeInstance(who.cutter);
      const only = await addInstance(who.character.id, ITEM_IDS.salvageCutter);
      return { ...who, only };
    }

    it("refuses the only usable Cutter anywhere and deletes nothing", async () => {
      const who = await onlyCarriedCutter();
      const result = await discard(who, who.only, ITEM_IDS.salvageCutter);
      expect(result.discard).toMatchObject({ status: "refused", reason: "last_cutter" });
      expect(await exists(who.only)).toBe(true);
      expect(result.state.inventory.uniqueItems.map((item) => item.id)).toContain(who.only);
    });

    it("is not satisfied by a higher Cutter the Mining level cannot yet use", async () => {
      const who = await onlyCarriedCutter();
      const locked = await addInstance(who.character.id, ITEM_IDS.loadsteelCutter);
      await stash(who.character.id, LOCATION_IDS.theJag, locked);
      const result = await discard(who, who.only, ITEM_IDS.salvageCutter);
      expect(result.discard).toMatchObject({ status: "refused", reason: "last_cutter" });
      expect(await exists(who.only)).toBe(true);
      // The unusable Cutter itself may go: a usable one remains.
      const dropLocked = await addInstance(who.character.id, ITEM_IDS.loadsteelCutter);
      const gone = await discard(who, dropLocked, ITEM_IDS.loadsteelCutter);
      expect(gone.discard.status).toBe("discarded");
    });

    it("counts a Cutter in a stash only once the Mining level can use it", async () => {
      const who = await onlyCarriedCutter();
      const loadsteel = await addInstance(who.character.id, ITEM_IDS.loadsteelCutter);
      await stash(who.character.id, LOCATION_IDS.theJag, loadsteel);
      await setMiningLevel(who.character.id, 5);
      const result = await discard(who, who.only, ITEM_IDS.salvageCutter);
      expect(result.discard.status).toBe("discarded");
      expect(await exists(loadsteel)).toBe(true);
    });

    it("allows a spare when the only replacement is in the ship Cargo Hold", async () => {
      const who = await onlyCarriedCutter();
      const other = await addInstance(who.character.id, ITEM_IDS.salvageCutter);
      await db.insert(rune.cargoHoldItemInstances).values({
        characterId: who.character.id,
        itemInstanceId: other,
      });
      const result = await discard(who, who.only, ITEM_IDS.salvageCutter);
      expect(result.discard.status).toBe("discarded");
      expect(await exists(other)).toBe(true);
    });

    it.each([
      LOCATION_IDS.theJag,
      LOCATION_IDS.ruskRecovery,
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.deepJag,
    ])("allows a spare when the only replacement is stored at %s", async (locationId) => {
      const who = await onlyCarriedCutter();
      const other = await addInstance(who.character.id, ITEM_IDS.salvageCutter);
      await stash(who.character.id, locationId, other);
      const result = await discard(who, who.only, ITEM_IDS.salvageCutter);
      expect(result.discard.status).toBe("discarded");
      expect(await exists(other)).toBe(true);
    });

    it("allows a spare when the replacement is equipped or merely carried", async () => {
      const equipped = await makeCharacter();
      const spare = await addInstance(equipped.character.id, ITEM_IDS.salvageCutter);
      expect((await discard(equipped, spare, ITEM_IDS.salvageCutter)).discard.status).toBe(
        "discarded",
      );

      const carried = await onlyCarriedCutter();
      const second = await addInstance(carried.character.id, ITEM_IDS.salvageCutter);
      expect((await discard(carried, second, ITEM_IDS.salvageCutter)).discard.status).toBe(
        "discarded",
      );
      expect(await exists(carried.only)).toBe(true);
      // ... and now the remaining one is the last, so it is protected.
      const last = await discard(carried, carried.only, ITEM_IDS.salvageCutter);
      expect(last.discard).toMatchObject({ status: "refused", reason: "last_cutter" });
    });

    it("refuses two simultaneous requests for the last two Cutters from deleting both", async () => {
      const who = await onlyCarriedCutter();
      const second = await addInstance(who.character.id, ITEM_IDS.salvageCutter);
      const results = await Promise.all([
        discard(who, who.only, ITEM_IDS.salvageCutter),
        discard(who, second, ITEM_IDS.salvageCutter),
      ]);
      expect(results.filter((r) => r.discard.status === "discarded")).toHaveLength(1);
      expect(results.filter((r) => r.discard.status === "refused")).toHaveLength(1);
      expect((await Promise.all([who.only, second].map(exists))).filter(Boolean)).toHaveLength(1);
    });
  });

  describe("equipped containers and equipment", () => {
    it("refuses direct discard of the last equipped container", async () => {
      const who = await makeCharacter();
      const result = await discard(who, who.pack, who.packItemId);
      expect(result.discard).toMatchObject({ status: "refused", reason: "equipped" });
      expect(await exists(who.pack)).toBe(true);
    });

    it("refuses direct discard of an equipped Cutter even when spares exist", async () => {
      const who = await makeCharacter();
      await addInstance(who.character.id, ITEM_IDS.salvageCutter);
      const result = await discard(who, who.cutter, ITEM_IDS.salvageCutter);
      expect(result.discard).toMatchObject({ status: "refused", reason: "equipped" });
      expect(await exists(who.cutter)).toBe(true);
    });

    it("still refuses unequipping the final container with an empty Inventory", async () => {
      const who = await makeCharacter();
      await expect(
        equipment.changeEquipment(
          who.userId,
          who.character.id,
          {
            kind: "unequip",
            target: { assignmentKind: "container", suitSlotId: containerSlots[0] },
          },
          now,
          successYield,
        ),
      ).rejects.toThrow("At least one compatible container must remain equipped.");
      const assigned = await db
        .select()
        .from(rune.equippedItems)
        .where(eq(rune.equippedItems.itemInstanceId, who.pack));
      expect(assigned).toHaveLength(1);
    });

    it("lets a container be unequipped then destroyed when another stays equipped", async () => {
      const who = await makeCharacter();
      const second = await addInstance(who.character.id, ITEM_IDS.mykeaSchleppraum8);
      await db.insert(rune.equippedItems).values({
        characterId: who.character.id,
        assignmentKind: "container",
        suitSlotId: containerSlots[1],
        itemInstanceId: second,
      });
      // Equipped: refused.
      expect((await discard(who, second, ITEM_IDS.mykeaSchleppraum8)).discard).toMatchObject({
        status: "refused",
        reason: "equipped",
      });
      await equipment.changeEquipment(
        who.userId,
        who.character.id,
        { kind: "unequip", target: { assignmentKind: "container", suitSlotId: containerSlots[1] } },
        now,
        successYield,
      );
      // Now carried and unequipped: discardable, and the first stays equipped.
      const result = await discard(who, second, ITEM_IDS.mykeaSchleppraum8);
      expect(result.discard.status).toBe("discarded");
      expect(await exists(second)).toBe(false);
      expect(await exists(who.pack)).toBe(true);
    });
  });

  describe("storage and identity refusals", () => {
    it("refuses Cargo, installed, stored, foreign, stale and forged targets without side effects", async () => {
      const who = await makeCharacter();
      const other = await makeCharacter();
      const inCargo = await addInstance(who.character.id, ITEM_IDS.scrapBox);
      await db.insert(rune.cargoHoldItemInstances).values({
        characterId: who.character.id,
        itemInstanceId: inCargo,
      });
      const installed = await addInstance(who.character.id, ITEM_IDS.scrapBox);
      await stash(who.character.id, LOCATION_IDS.ruskRecovery, installed, "installed");
      const stored = await addInstance(who.character.id, ITEM_IDS.freightHarness);
      await stash(who.character.id, LOCATION_IDS.deepJag, stored);
      const foreign = await addInstance(other.character.id, ITEM_IDS.scrapBox);
      const carried = await addInstance(who.character.id, ITEM_IDS.scrapBox);
      const before = await instanceCount(who.character.id);
      const otherBefore = await instanceCount(other.character.id);

      const cases: [string, string, string, string][] = [
        [inCargo, ITEM_IDS.scrapBox, "in_cargo", "cargo"],
        [installed, ITEM_IDS.scrapBox, "installed", "installed"],
        [stored, ITEM_IDS.freightHarness, "stored", "stored"],
        [foreign, ITEM_IDS.scrapBox, "not_found", "foreign"],
        [crypto.randomUUID(), ITEM_IDS.scrapBox, "not_found", "forged"],
        [carried, ITEM_IDS.freightHarness, "changed", "stale identity"],
      ];
      for (const [id, expected, reason, label] of cases) {
        const result = await discard(who, id, expected);
        expect(result.discard, label).toMatchObject({ status: "refused", reason });
      }
      expect(await instanceCount(who.character.id)).toBe(before);
      expect(await instanceCount(other.character.id)).toBe(otherBefore);
      expect(await exists(foreign)).toBe(true);
    });

    it("rejects a user who does not own the character", async () => {
      const who = await makeCharacter();
      const intruder = await makeCharacter();
      const spare = await addInstance(who.character.id, ITEM_IDS.scrapBox);
      await expect(
        inventory.discardUniqueItem(intruder.userId, who.character.id, {
          itemInstanceId: spare,
          expectedItemId: ITEM_IDS.scrapBox,
        }),
      ).rejects.toThrow(OwnershipError);
      expect(await exists(spare)).toBe(true);
    });

    it("exactly one of duplicate or concurrent requests destroys the item", async () => {
      const who = await makeCharacter();
      const spare = await addInstance(who.character.id, ITEM_IDS.scrapBox);
      const results = await Promise.all([
        discard(who, spare, ITEM_IDS.scrapBox),
        discard(who, spare, ITEM_IDS.scrapBox),
      ]);
      expect(results.filter((r) => r.discard.status === "discarded")).toHaveLength(1);
      expect(results.filter((r) => r.discard.status === "refused")).toHaveLength(1);
      const retried = await discard(who, spare, ITEM_IDS.scrapBox);
      expect(retried.discard).toMatchObject({ status: "refused", reason: "not_found" });
      expect(await exists(who.pack)).toBe(true);
    });

    it("an item unequipped from Equipment becomes discardable", async () => {
      const who = await makeCharacter();
      const spare = await addInstance(who.character.id, ITEM_IDS.salvageCutter);
      expect((await discard(who, who.cutter, ITEM_IDS.salvageCutter)).discard).toMatchObject({
        reason: "equipped",
      });
      await equipment.changeEquipment(
        who.userId,
        who.character.id,
        { kind: "unequip", target: { assignmentKind: "gear", suitSlotId: "mining_tool" } },
        now,
        successYield,
      );
      const result = await discard(who, who.cutter, ITEM_IDS.salvageCutter);
      expect(result.discard.status).toBe("discarded");
      expect(await exists(spare)).toBe(true);
    });
  });

  describe("mission-bound items", () => {
    it("refuses the generic path for a held research loan, and leaves the run intact", async () => {
      const who = await makeCharacter();
      const loan = await addInstance(who.character.id, ITEM_IDS.sealedResearchPacket);
      await db.insert(rune.characterResearchAssignments).values({
        characterId: who.character.id,
        jobId: RESEARCH_JOB_IDS.researchCourier,
        itemInstanceId: loan,
        startedAt: now,
      });
      const result = await discard(who, loan, ITEM_IDS.sealedResearchPacket);
      expect(result.discard).toMatchObject({ status: "refused", reason: "mission_bound" });
      expect(await exists(loan)).toBe(true);
      const runs = await db
        .select()
        .from(rune.characterResearchAssignments)
        .where(eq(rune.characterResearchAssignments.characterId, who.character.id));
      expect(runs).toMatchObject([{ itemInstanceId: loan }]);
    });

    it("lets an orphaned loan item that no run holds be destroyed", async () => {
      const who = await makeCharacter();
      const loan = await addInstance(who.character.id, ITEM_IDS.sealedResearchPacket);
      const result = await discard(who, loan, ITEM_IDS.sealedResearchPacket);
      expect(result.discard.status).toBe("discarded");
    });
  });

  describe("lazy action reconciliation", () => {
    it("resolves due Mining exactly once and then destroys the item once", async () => {
      const who = await makeCharacter();
      const spare = await addInstance(who.character.id, ITEM_IDS.scrapBox);
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.theJag })
        .where(eq(rune.characters.id, who.character.id));
      await miningCommands.startMining(who.userId, who.character.id, now, successYield);
      const dueAt = new Date(now.getTime() + 6_000);

      const result = await discard(who, spare, ITEM_IDS.scrapBox, dueAt);
      expect(result.discard.status).toBe("discarded");
      expect(result.state.run).toMatchObject({ attempts: 1, successes: 1 });
      expect(await exists(spare)).toBe(false);

      const again = await discard(who, spare, ITEM_IDS.scrapBox, dueAt);
      expect(again.discard).toMatchObject({ status: "refused", reason: "not_found" });
      expect(again.state.run).toMatchObject({ attempts: 1, successes: 1 });
    });
  });

  it("leaves ordinary stack Drop untouched", async () => {
    const who = await makeCharacter();
    const [stack] = await db
      .insert(rune.inventoryStacks)
      .values({ characterId: who.character.id, itemId: ITEM_IDS.ferriteShale, quantity: 3 })
      .returning({ id: rune.inventoryStacks.id });
    const dropped = await inventory.discardInventoryStack(who.userId, who.character.id, {
      stackId: stack!.id,
      mode: "one",
      expectedQuantity: 3,
    });
    expect(dropped.discard).toMatchObject({ status: "discarded", discardedQuantity: 1 });
    // A stack ID is not an instance ID: the unique command finds nothing.
    const wrongKind = await discard(who, stack!.id, ITEM_IDS.ferriteShale);
    expect(wrongKind.discard).toMatchObject({ status: "refused", reason: "not_found" });
  });
});
