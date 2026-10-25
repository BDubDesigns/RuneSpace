import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { TradeCommandResult, TradeStateView } from "@/game/schemas/player-trade";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS, LOCAL_PLACE_IDS, LOCATION_IDS, ACTION_IDS } from "@/game/config/foundations";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #399 — the FedHex mailbox and the Legendary miner's set, against real
 * PostgreSQL.
 *
 * What only the database proves: that a claim mints exactly one unique instance
 * and stamps the parcel in one transaction, so a second claim, a concurrent pair
 * and a retry can never mint another; that capacity (slot AND mass) refuses
 * without touching the parcel; that the claim is refused away from a FedHex
 * pickup, mid-activity and mid-flight, and for any character but the recipient;
 * that mail never expires; that a claimed Legendary equips, raises the success
 * chance only, and trades through the unchanged bilateral flow.
 */
suite("issue #399 FedHex mailbox and Legendary gear (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let fedhex: typeof import("@/server/fedhex");
  let commands: typeof import("@/server/fedhex-commands");
  let equipment: typeof import("@/server/equipment");
  let trades: typeof import("@/server/player-trades");
  let actionResolution: typeof import("@/server/action-resolution");
  const createdUsers: string[] = [];
  const start = new Date("2026-10-24T12:00:00.000Z");
  const balance = getEffectiveGameBalance();
  const STILLREACH = LOCAL_PLACE_IDS.fedhexStillreachLandingStation;
  const HOLLOW = LOCAL_PLACE_IDS.fedhexHoloHollowLanding;
  const GLOVES = ITEM_IDS.minersGloves;
  const BOOTS = ITEM_IDS.minersBoots;
  const quiet = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    fedhex = await import("@/server/fedhex");
    commands = await import("@/server/fedhex-commands");
    equipment = await import("@/server/equipment");
    trades = await import("@/server/player-trades");
    actionResolution = await import("@/server/action-resolution");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter(label: string, locationId: string) {
    const userId = await createTestUser(db, authSchema, label);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Fed ${userId.slice(0, 6)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, quiet());
    await move(character.id, locationId);
    return { userId, characterId: character.id };
  }

  async function move(characterId: string, locationId: string) {
    await db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));
  }

  /** One recovery parcel, written by the same function the Echo discovery calls. */
  async function mail(characterId: string, itemId: string, readAt = start) {
    await db.transaction((tx) =>
      fedhex.createEchoRecoveryParcel(tx, { characterId, itemId, readAt }),
    );
    const rows = await parcels(characterId);
    return rows.find((row) => row.receivedAt.getTime() === readAt.getTime())!;
  }

  async function parcels(characterId: string) {
    return db
      .select()
      .from(rune.fedhexParcels)
      .where(eq(rune.fedhexParcels.characterId, characterId));
  }

  async function instancesOf(characterId: string, itemId: string) {
    return db
      .select()
      .from(rune.itemInstances)
      .where(
        and(eq(rune.itemInstances.characterId, characterId), eq(rune.itemInstances.itemId, itemId)),
      );
  }

  async function fillSlots(characterId: string, freeSlots: number) {
    const state = await play.getPlayGameplayState(
      (await ownerOf(characterId)) as string,
      characterId,
      start,
      quiet(),
    );
    for (let index = state.inventory.slotsAvailable - freeSlots; index > 0; index -= 1) {
      await db
        .insert(rune.inventoryStacks)
        .values({ characterId, itemId: ITEM_IDS.uncutQuartz, quantity: 1 });
    }
  }

  async function ownerOf(characterId: string) {
    const [row] = await db
      .select({ userId: rune.playerAccounts.userId })
      .from(rune.characters)
      .innerJoin(rune.playerAccounts, eq(rune.playerAccounts.id, rune.characters.playerAccountId))
      .where(eq(rune.characters.id, characterId));
    return row?.userId;
  }

  const claim = (
    who: { userId: string; characterId: string },
    parcelId: string,
    localPlaceId: string,
    now = start,
  ) => commands.claimFedhexParcel(who.userId, who.characterId, { parcelId, localPlaceId }, now);

  describe("the mailbox", () => {
    it("is one character-owned mailbox, the same from either pickup, and empty by default", async () => {
      const who = await makeCharacter("Empty", LOCATION_IDS.holoHollowLanding);
      const empty = await play.getPlayGameplayState(who.userId, who.characterId, start, quiet());
      expect(empty.fedhex).toEqual({ pendingCount: 0, parcels: [] });
      const parcel = await mail(who.characterId, GLOVES);
      // Standing at Holo Hollow Landing sees a parcel that was mailed for a Stillreach find.
      const there = await play.getPlayGameplayState(who.userId, who.characterId, start, quiet());
      expect(there.fedhex.pendingCount).toBe(1);
      expect(there.fedhex.parcels[0]).toMatchObject({
        parcelId: parcel.id,
        senderDisplayName: "The Wise Old Enby",
        subject: "Hey, did you drop this? 😏",
        attachment: { itemId: GLOVES, name: "Miner's Gloves" },
      });
      await move(who.characterId, LOCATION_IDS.stillreachLandingStation);
      const here = await play.getPlayGameplayState(who.userId, who.characterId, start, quiet());
      expect(here.fedhex.parcels.map((p) => p.parcelId)).toEqual([parcel.id]);
    });

    it("never shows another character's mail", async () => {
      const a = await makeCharacter("MailA", LOCATION_IDS.stillreachLandingStation);
      const b = await makeCharacter("MailB", LOCATION_IDS.stillreachLandingStation);
      await mail(a.characterId, GLOVES);
      const state = await play.getPlayGameplayState(b.userId, b.characterId, start, quiet());
      expect(state.fedhex).toEqual({ pendingCount: 0, parcels: [] });
    });

    it("is written once per event: a replayed write creates no second parcel", async () => {
      const who = await makeCharacter("Replay", LOCATION_IDS.stillreachLandingStation);
      await mail(who.characterId, GLOVES);
      await mail(who.characterId, GLOVES);
      expect(await parcels(who.characterId)).toHaveLength(1);
    });
  });

  describe("claiming one parcel", () => {
    it("mints exactly one unique instance, stamps the parcel and leaves an ordinary carried item", async () => {
      const who = await makeCharacter("Claim", LOCATION_IDS.stillreachLandingStation);
      const parcel = await mail(who.characterId, GLOVES);
      const result = await claim(who, parcel.id, STILLREACH);
      expect(result.claim).toMatchObject({
        status: "claimed",
        parcelId: parcel.id,
        itemId: GLOVES,
      });
      const instances = await instancesOf(who.characterId, GLOVES);
      expect(instances).toHaveLength(1);
      const [row] = await parcels(who.characterId);
      expect(row).toMatchObject({ claimedItemInstanceId: instances[0]!.id });
      expect(row!.claimedAt).toEqual(start);
      expect(result.state.fedhex).toEqual({ pendingCount: 0, parcels: [] });
      // An unequipped carried unique item like any other, tradable and equippable.
      expect(result.state.inventory.uniqueItems.some((item) => item.itemId === GLOVES)).toBe(true);
      const slot = result.state.equipment.slots.find((s) => s.label === "Gloves");
      expect(slot?.eligibleItems.map((item) => item.itemId)).toEqual([GLOVES]);
    });

    it("claims at either pickup, each only from its own landing", async () => {
      const who = await makeCharacter("Either", LOCATION_IDS.holoHollowLanding);
      const parcel = await mail(who.characterId, BOOTS);
      expect((await claim(who, parcel.id, STILLREACH)).claim).toMatchObject({
        status: "refused",
        reason: "not_at_fedhex",
      });
      expect(await instancesOf(who.characterId, BOOTS)).toHaveLength(0);
      expect((await claim(who, parcel.id, HOLLOW)).claim.status).toBe("claimed");
    });

    it("refuses away from a FedHex pickup, writing nothing", async () => {
      const who = await makeCharacter("Away", LOCATION_IDS.hilltopWorkshop);
      const parcel = await mail(who.characterId, GLOVES);
      for (const place of [STILLREACH, HOLLOW]) {
        expect((await claim(who, parcel.id, place)).claim).toMatchObject({
          status: "refused",
          reason: "not_at_fedhex",
        });
      }
      // A real Local Place that is not FedHex is no pickup either.
      expect(
        (await claim(who, parcel.id, LOCAL_PLACE_IDS.stillreachRefinerToGo)).claim,
      ).toMatchObject({ status: "refused" });
      expect((await parcels(who.characterId))[0]!.claimedAt).toBeNull();
      expect(await instancesOf(who.characterId, GLOVES)).toHaveLength(0);
    });

    it("refuses while travelling or busy, and while the ship is in flight", async () => {
      const who = await makeCharacter("Busy", LOCATION_IDS.stillreachLandingStation);
      const parcel = await mail(who.characterId, GLOVES);
      await db.insert(rune.activeActions).values({
        characterId: who.characterId,
        actionId: ACTION_IDS.travel,
        startedAt: start,
        resolvedThroughAt: start,
      });
      expect((await claim(who, parcel.id, STILLREACH)).claim).toMatchObject({
        status: "refused",
        reason: "in_transit",
      });
      await db
        .update(rune.activeActions)
        .set({ actionId: ACTION_IDS.shipFlight })
        .where(eq(rune.activeActions.characterId, who.characterId));
      await expect(claim(who, parcel.id, STILLREACH)).rejects.toBeInstanceOf(
        actionResolution.ShipInFlightError,
      );
      await db
        .update(rune.activeActions)
        .set({ actionId: ACTION_IDS.ferriteShaleMining })
        .where(eq(rune.activeActions.characterId, who.characterId));
      expect((await claim(who, parcel.id, STILLREACH)).claim).toMatchObject({
        status: "refused",
        reason: "active_action",
      });
      expect((await parcels(who.characterId))[0]!.claimedAt).toBeNull();
      expect(await instancesOf(who.characterId, GLOVES)).toHaveLength(0);
    });

    it("keeps the parcel untouched, with a usable reason, when there is no slot or no mass", async () => {
      const who = await makeCharacter("Full", LOCATION_IDS.stillreachLandingStation);
      const parcel = await mail(who.characterId, BOOTS);
      await fillSlots(who.characterId, 0);
      const bySlot = await claim(who, parcel.id, STILLREACH);
      expect(bySlot.claim).toMatchObject({ status: "refused", reason: "no_slot" });
      if (bySlot.claim.status === "refused") expect(bySlot.claim.message).toMatch(/full/i);
      // Free a slot but leave less mass than the 2 kg Boots need.
      await db
        .delete(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, who.characterId));
      await db.insert(rune.inventoryStacks).values({
        characterId: who.characterId,
        itemId: ITEM_IDS.motherlodeSlab,
        quantity: 1,
      });
      const slabs = Math.floor((balance.carrying.startingCapacityGrams - 2_000 + 1) / 12_000);
      for (let index = 0; index < slabs; index += 1) {
        await db.insert(rune.inventoryStacks).values({
          characterId: who.characterId,
          itemId: ITEM_IDS.motherlodeSlab,
          quantity: 1,
        });
      }
      const byMass = await claim(who, parcel.id, STILLREACH);
      expect(byMass.claim).toMatchObject({ status: "refused" });
      expect((await parcels(who.characterId))[0]).toMatchObject({
        claimedAt: null,
        claimedItemInstanceId: null,
      });
      expect(await instancesOf(who.characterId, BOOTS)).toHaveLength(0);
    });

    it("succeeds once room is made, with no consumption by the earlier refusals", async () => {
      const who = await makeCharacter("Room", LOCATION_IDS.stillreachLandingStation);
      const parcel = await mail(who.characterId, GLOVES);
      await fillSlots(who.characterId, 0);
      expect((await claim(who, parcel.id, STILLREACH)).claim).toMatchObject({ reason: "no_slot" });
      await db
        .delete(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, who.characterId));
      expect((await claim(who, parcel.id, STILLREACH)).claim.status).toBe("claimed");
      expect(await instancesOf(who.characterId, GLOVES)).toHaveLength(1);
    });

    it("claims one parcel at a time and leaves the rest pending", async () => {
      const who = await makeCharacter("Many", LOCATION_IDS.stillreachLandingStation);
      const first = await mail(who.characterId, GLOVES, start);
      const second = await mail(who.characterId, GLOVES, new Date(start.getTime() + 1_000));
      const result = await claim(who, first.id, STILLREACH);
      expect(result.claim.status).toBe("claimed");
      expect(result.state.fedhex.parcels.map((p) => p.parcelId)).toEqual([second.id]);
      expect(await instancesOf(who.characterId, GLOVES)).toHaveLength(1);
    });

    it("cannot be claimed twice, sequentially or by two sessions at once", async () => {
      const who = await makeCharacter("Twice", LOCATION_IDS.stillreachLandingStation);
      const parcel = await mail(who.characterId, GLOVES);
      expect((await claim(who, parcel.id, STILLREACH)).claim.status).toBe("claimed");
      expect((await claim(who, parcel.id, STILLREACH)).claim).toMatchObject({
        status: "refused",
        reason: "already_claimed",
      });
      expect(await instancesOf(who.characterId, GLOVES)).toHaveLength(1);

      const racer = await makeCharacter("Race", LOCATION_IDS.stillreachLandingStation);
      const contested = await mail(racer.characterId, BOOTS);
      const results = await Promise.all([
        claim(racer, contested.id, STILLREACH),
        claim(racer, contested.id, STILLREACH),
        claim(racer, contested.id, STILLREACH),
      ]);
      expect(results.filter((r) => r.claim.status === "claimed")).toHaveLength(1);
      expect(
        results.filter((r) => r.claim.status === "refused" && r.claim.reason === "already_claimed"),
      ).toHaveLength(2);
      expect(await instancesOf(racer.characterId, BOOTS)).toHaveLength(1);
    });

    it("cannot be claimed by another character or through another account", async () => {
      const owner = await makeCharacter("Owner", LOCATION_IDS.stillreachLandingStation);
      const thief = await makeCharacter("Thief", LOCATION_IDS.stillreachLandingStation);
      const parcel = await mail(owner.characterId, GLOVES);
      expect((await claim(thief, parcel.id, STILLREACH)).claim).toMatchObject({
        status: "refused",
        reason: "not_found",
      });
      // The thief's account cannot act as the owner's character at all.
      await expect(
        commands.claimFedhexParcel(
          thief.userId,
          owner.characterId,
          { parcelId: parcel.id, localPlaceId: STILLREACH },
          start,
        ),
      ).rejects.toThrow();
      expect((await parcels(owner.characterId))[0]!.claimedAt).toBeNull();
      expect(await instancesOf(thief.characterId, GLOVES)).toHaveLength(0);
      expect(await instancesOf(owner.characterId, GLOVES)).toHaveLength(0);
    });

    it("never expires", async () => {
      const who = await makeCharacter("Forever", LOCATION_IDS.stillreachLandingStation);
      const parcel = await mail(who.characterId, GLOVES);
      const later = new Date(start.getTime() + 400 * 24 * 60 * 60 * 1_000);
      const state = await play.getPlayGameplayState(who.userId, who.characterId, later, quiet());
      expect(state.fedhex.pendingCount).toBe(1);
      expect((await claim(who, parcel.id, STILLREACH, later)).claim.status).toBe("claimed");
    });

    it("never announces: a claim writes no chat line", async () => {
      const who = await makeCharacter("Quiet", LOCATION_IDS.stillreachLandingStation);
      const parcel = await mail(who.characterId, GLOVES);
      const before = await db
        .select()
        .from(rune.chatMessages)
        .where(eq(rune.chatMessages.kind, "legendary_find"));
      await claim(who, parcel.id, STILLREACH);
      const after = await db
        .select()
        .from(rune.chatMessages)
        .where(eq(rune.chatMessages.kind, "legendary_find"));
      expect(after).toHaveLength(before.length);
    });
  });

  describe("wearing the claimed set", () => {
    async function claimed(label: string, itemId: string) {
      const who = await makeCharacter(label, LOCATION_IDS.stillreachLandingStation);
      const parcel = await mail(who.characterId, itemId);
      await claim(who, parcel.id, STILLREACH);
      const [instance] = await instancesOf(who.characterId, itemId);
      return { ...who, instanceId: instance!.id };
    }
    const feet = { assignmentKind: "gear", suitSlotId: balance.carrying.feetSuitSlotId } as const;
    const hands = { assignmentKind: "gear", suitSlotId: balance.carrying.handsSuitSlotId } as const;

    it("raises the Mining success chance only, +1 each and +2 together, at natural Mining 1", async () => {
      const who = await claimed("Wear", BOOTS);
      const parcel = await mail(who.characterId, GLOVES, new Date(start.getTime() + 5_000));
      await claim(who, parcel.id, STILLREACH);
      await move(who.characterId, LOCATION_IDS.theJag);
      const read = async () =>
        play.getPlayGameplayState(who.userId, who.characterId, start, quiet());
      const base = await read();
      const natural = base.miningSource!.successChanceBps;
      expect(base.equipment.miningSuccessLevelBonus).toBe(0);

      const [gloves] = await instancesOf(who.characterId, GLOVES);
      const one = await equipment.changeEquipment(
        who.userId,
        who.characterId,
        { kind: "equip", itemInstanceId: who.instanceId, target: feet },
        start,
      );
      expect(one.equipment.miningSuccessLevelBonus).toBe(1);
      expect(one.miningSource!.successChanceBps).toBeGreaterThan(natural);
      expect(one.miningSource!.successLevelBonus).toBe(1);
      const two = await equipment.changeEquipment(
        who.userId,
        who.characterId,
        { kind: "equip", itemInstanceId: gloves!.id, target: hands },
        start,
      );
      expect(two.equipment.miningSuccessLevelBonus).toBe(2);
      expect(two.miningSource!.successChanceBps).toBeGreaterThan(
        one.miningSource!.successChanceBps,
      );
      // Natural level, gates and every other output are untouched.
      expect(two.mining.level).toBe(base.mining.level);
      expect(two.miningSource!.requiredMiningLevel).toBe(base.miningSource!.requiredMiningLevel);
      expect(two.miningSource!.successXp).toBe(base.miningSource!.successXp);
      expect(two.miningSource!.yieldMinimum).toBe(base.miningSource!.yieldMinimum);
      expect(two.miningSource!.attemptDurationTicks).toBe(base.miningSource!.attemptDurationTicks);
      const unequipped = await equipment.changeEquipment(
        who.userId,
        who.characterId,
        { kind: "unequip", target: feet },
        start,
      );
      expect(unequipped.equipment.miningSuccessLevelBonus).toBe(1);
    });

    it("refuses to put Boots on the hands, and the slots accept only their own piece", async () => {
      const who = await claimed("WrongSlot", BOOTS);
      await expect(
        equipment.changeEquipment(
          who.userId,
          who.characterId,
          { kind: "equip", itemInstanceId: who.instanceId, target: hands },
          start,
        ),
      ).rejects.toThrow(/not compatible/i);
    });

    it("trades through the unchanged bilateral flow once carried and unequipped", async () => {
      const seller = await claimed("Seller", BOOTS);
      // A duplicate is allowed: one pair is worn, the spare is simply carried.
      const spareParcel = await mail(seller.characterId, BOOTS, new Date(start.getTime() + 2_000));
      await claim(seller, spareParcel.id, STILLREACH);
      const pairs = await instancesOf(seller.characterId, BOOTS);
      expect(pairs).toHaveLength(2);
      const spare = pairs.find((row) => row.id !== seller.instanceId)!;
      await equipment.changeEquipment(
        seller.userId,
        seller.characterId,
        { kind: "equip", itemInstanceId: seller.instanceId, target: feet },
        start,
      );
      const buyer = await makeCharacter("Buyer", LOCATION_IDS.stillreachLandingStation);
      const ok = (result: TradeCommandResult): TradeStateView => {
        if (result.status !== "ok") throw new Error(`expected ok, got ${result.reason}`);
        return result.state;
      };
      const sent = ok(
        await trades.createTradeRequest(
          seller.userId,
          seller.characterId,
          { characterId: buyer.characterId },
          start,
        ),
      );
      const accepted = ok(
        await trades.acceptTradeRequest(buyer.userId, buyer.characterId, sent.outgoing!.id, start),
      );
      const sessionId = accepted.session!.id;
      const version = async () =>
        (
          await db
            .select({ v: rune.playerTradeSessions.offerVersion })
            .from(rune.playerTradeSessions)
            .where(eq(rune.playerTradeSessions.id, sessionId))
        )[0]!.v;
      // The worn pair cannot be offered; the carried spare can.
      expect(
        await trades.addTradeOfferItem(
          seller.userId,
          seller.characterId,
          sessionId,
          await version(),
          seller.instanceId,
          start,
        ),
      ).toMatchObject({ status: "refused" });
      ok(
        await trades.addTradeOfferItem(
          seller.userId,
          seller.characterId,
          sessionId,
          await version(),
          spare.id,
          start,
        ),
      );
      for (const who of [seller, buyer]) {
        ok(
          await trades.readyTradeOffer(
            who.userId,
            who.characterId,
            sessionId,
            await version(),
            start,
          ),
        );
      }
      ok(
        await trades.confirmTrade(
          seller.userId,
          seller.characterId,
          sessionId,
          await version(),
          start,
        ),
      );
      ok(
        await trades.confirmTrade(
          buyer.userId,
          buyer.characterId,
          sessionId,
          await version(),
          start,
        ),
      );
      // The very same instance now belongs to the buyer: identity is preserved.
      expect((await instancesOf(seller.characterId, BOOTS)).map((row) => row.id)).toEqual([
        seller.instanceId,
      ]);
      const owned = await instancesOf(buyer.characterId, BOOTS);
      expect(owned.map((row) => row.id)).toEqual([spare.id]);
    });
  });
});
