import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Character } from "@/db/rune-space";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import type { TradeCommandResult, TradeStateView } from "@/game/schemas/player-trade";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const RUNE = ITEM_IDS.skatbollTpRune;
const STILLREACH = LOCATION_IDS.stillreachLandingStation;
const HOLLOW = LOCATION_IDS.holoHollow;
const CRASH_SITE = LOCATION_IDS.crashSite;
const token = () => Math.random().toString(36).slice(2, 10);

type Player = { userId: string; character: Character };

/**
 * Issue #438 — the Skatboll TP Rune's Use, against real PostgreSQL.
 *
 * What only the database proves: exactly one rune is consumed and the character
 * alone moves, atomically with the receipt; a duplicate, retried or concurrent
 * request can never spend a second rune or issue a second arrival; every refusal
 * (busy, travelling, in flight, trade-engaged, already there, stale or not-carried
 * stack) writes nothing; and the arrival receipt is presentation-only.
 */
suite("issue #438 Skatboll TP Rune (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let commands: typeof import("@/server/rune-teleport-commands");
  let trades: typeof import("@/server/player-trades");
  let actionResolution: typeof import("@/server/action-resolution");
  const createdUsers: string[] = [];
  const start = new Date("2026-10-30T12:00:00.000Z");
  const quiet = () => ({ nextBasisPoints: () => 0, nextUnit: () => 0 });

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    commands = await import("@/server/rune-teleport-commands");
    trades = await import("@/server/player-trades");
    actionResolution = await import("@/server/action-resolution");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function player(locationId: string = STILLREACH): Promise<Player> {
    const userId = await createTestUser(db, authSchema, `tp-${token()}`);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Tp${token()}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, start, quiet());
    await move(character.id, locationId);
    return { userId, character };
  }

  const move = (characterId: string, locationId: string) =>
    db
      .update(rune.characters)
      .set({ currentLocationId: locationId })
      .where(eq(rune.characters.id, characterId));

  async function give(who: Player, quantity: number, itemId: string = RUNE): Promise<string> {
    const [row] = await db
      .insert(rune.inventoryStacks)
      .values({ characterId: who.character.id, itemId, quantity })
      .returning({ id: rune.inventoryStacks.id });
    return row!.id;
  }

  async function held(who: Player, itemId: string = RUNE) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, who.character.id),
          eq(rune.inventoryStacks.itemId, itemId),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  async function locationOf(who: Player) {
    const [row] = await db
      .select({ at: rune.characters.currentLocationId })
      .from(rune.characters)
      .where(eq(rune.characters.id, who.character.id));
    return row!.at;
  }

  const receipts = (who: Player) =>
    db
      .select()
      .from(rune.characterRuneTeleports)
      .where(eq(rune.characterRuneTeleports.characterId, who.character.id));

  const use = (
    who: Player,
    stackId: string,
    expectedQuantity: number,
    intentId: string = crypto.randomUUID(),
    now = start,
  ) =>
    commands.teleportWithRune(
      who.userId,
      who.character.id,
      { intentId, stackId, expectedQuantity },
      now,
    );

  /** Everything a teleport must leave alone: ship, Cargo Hold, Equipment, skill XP, Credits. */
  async function untouched(who: Player) {
    const [ship] = await db
      .select()
      .from(rune.characterShips)
      .where(eq(rune.characterShips.characterId, who.character.id));
    const cargo = await db
      .select()
      .from(rune.cargoHoldStacks)
      .where(eq(rune.cargoHoldStacks.characterId, who.character.id));
    const equipment = await db
      .select()
      .from(rune.equippedItems)
      .where(eq(rune.equippedItems.characterId, who.character.id));
    const xp = await db
      .select()
      .from(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, who.character.id));
    const [row] = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, who.character.id));
    return { ship, cargo, equipment, xp, credits: row!.credits };
  }

  describe("a successful Use", () => {
    it("moves a Runeworking 1 character with no Rig to the Crash Site, consuming exactly one rune", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 3);
      const other = await give(who, 4, ITEM_IDS.ferriteShale);
      await db.insert(rune.cargoHoldStacks).values({
        characterId: who.character.id,
        itemId: ITEM_IDS.ferriteShale,
        quantity: 2,
      });
      const before = await untouched(who);

      const result = await use(who, stackId, 3);

      expect(result.teleport).toMatchObject({ status: "teleported", alreadySettled: false });
      expect(await locationOf(who)).toBe(CRASH_SITE);
      expect(await held(who)).toBe(2);
      expect(await held(who, ITEM_IDS.ferriteShale)).toBe(4);
      expect(other).toBeTruthy();
      expect(result.state.location.currentLocationId).toBe(CRASH_SITE);
      expect(result.state.activeAction).toBeUndefined();
      // No Runeworking XP, no cooldown, nothing but the character moved.
      expect(await untouched(who)).toEqual(before);
      expect(await receipts(who)).toHaveLength(1);
      expect(result.state.runeTeleport.arrival).toMatchObject({
        itemId: RUNE,
        locationId: CRASH_SITE,
        name: "Crash Site",
        planetName: "Skatboll",
      });
    });

    it("goes to the very same Crash Site from another Skatboll tile", async () => {
      const who = await player(HOLLOW);
      const stackId = await give(who, 1);
      const result = await use(who, stackId, 1);
      expect(result.teleport.status).toBe("teleported");
      expect(await locationOf(who)).toBe(CRASH_SITE);
      expect(await held(who)).toBe(0);
    });

    it("allows distinct later teleports with no cooldown", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 2);
      expect((await use(who, stackId, 2)).teleport.status).toBe("teleported");
      await move(who.character.id, STILLREACH);
      expect((await use(who, stackId, 1)).teleport.status).toBe("teleported");
      expect(await held(who)).toBe(0);
      expect(await receipts(who)).toHaveLength(2);
    });
  });

  describe("refusals consume nothing and move nobody", () => {
    async function expectNothingChanged(who: Player, at: string, quantity: number) {
      expect(await locationOf(who)).toBe(at);
      expect(await held(who)).toBe(quantity);
      expect(await receipts(who)).toHaveLength(0);
    }

    it("refuses at the destination itself", async () => {
      const who = await player(CRASH_SITE);
      const stackId = await give(who, 2);
      expect((await use(who, stackId, 2)).teleport).toMatchObject({
        status: "refused",
        reason: "already_there",
      });
      await expectNothingChanged(who, CRASH_SITE, 2);
    });

    it("refuses while another activity runs, without interrupting it", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 2);
      await db.insert(rune.activeActions).values({
        characterId: who.character.id,
        actionId: ACTION_IDS.ferriteShaleMining,
        startedAt: start,
        resolvedThroughAt: start,
      });
      expect((await use(who, stackId, 2)).teleport).toMatchObject({
        status: "refused",
        reason: "another_action_active",
      });
      await expectNothingChanged(who, STILLREACH, 2);
      const [action] = await db
        .select()
        .from(rune.activeActions)
        .where(eq(rune.activeActions.characterId, who.character.id));
      expect(action?.actionId).toBe(ACTION_IDS.ferriteShaleMining);
    });

    it("refuses while walking", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 2);
      await db.insert(rune.activeActions).values({
        characterId: who.character.id,
        actionId: ACTION_IDS.travel,
        startedAt: start,
        resolvedThroughAt: start,
      });
      const result = await use(who, stackId, 2);
      expect(result.teleport).toMatchObject({ status: "refused", reason: "another_action_active" });
      await expectNothingChanged(who, STILLREACH, 2);
    });

    it("refuses during ship flight and passenger travel at the shared boundary", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 2);
      for (const actionId of [ACTION_IDS.shipFlight, ACTION_IDS.passengerTravel]) {
        await db
          .insert(rune.activeActions)
          .values({
            characterId: who.character.id,
            actionId,
            startedAt: start,
            resolvedThroughAt: start,
          })
          .onConflictDoUpdate({
            target: rune.activeActions.characterId,
            set: { actionId },
          });
        await expect(use(who, stackId, 2)).rejects.toBeInstanceOf(ownership.OwnershipError);
      }
      await expect(use(who, stackId, 2)).rejects.toBeInstanceOf(
        actionResolution.PassengerInTransitError,
      );
      await expectNothingChanged(who, STILLREACH, 2);
    });

    it("refuses while a player trade is pending", async () => {
      const a = await player(STILLREACH);
      const b = await player(STILLREACH);
      const stackId = await give(a, 2);
      const sent = await trades.createTradeRequest(
        a.userId,
        a.character.id,
        { characterId: b.character.id },
        start,
      );
      expect(sent.status).toBe("ok");
      await expect(use(a, stackId, 2)).rejects.toBeInstanceOf(ownership.OwnershipError);
      await expectNothingChanged(a, STILLREACH, 2);
    });

    it("refuses a stale quantity, a vanished stack, a foreign stack, a Cargo Hold stack and a non-rune stack", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 3);
      const stranger = await player(STILLREACH);
      const foreign = await give(stranger, 3);
      const shale = await give(who, 2, ITEM_IDS.ferriteShale);
      const [cargo] = await db
        .insert(rune.cargoHoldStacks)
        .values({ characterId: who.character.id, itemId: RUNE, quantity: 2 })
        .returning({ id: rune.cargoHoldStacks.id });

      expect((await use(who, stackId, 5)).teleport).toMatchObject({ reason: "stack_changed" });
      expect((await use(who, crypto.randomUUID(), 3)).teleport).toMatchObject({
        reason: "stack_not_found",
      });
      expect((await use(who, foreign, 3)).teleport).toMatchObject({ reason: "stack_not_found" });
      expect((await use(who, cargo!.id, 2)).teleport).toMatchObject({ reason: "stack_not_found" });
      expect((await use(who, shale, 2)).teleport).toMatchObject({
        reason: "not_a_teleport_rune",
      });
      await expectNothingChanged(who, STILLREACH, 3);
      expect(await held(stranger)).toBe(3);
      expect(await locationOf(stranger)).toBe(STILLREACH);
    });
  });

  describe("exactly-once settlement", () => {
    it("a duplicate or retried intent spends no second rune and issues no second arrival", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 3);
      const intentId = crypto.randomUUID();
      expect((await use(who, stackId, 3, intentId)).teleport).toMatchObject({
        status: "teleported",
        alreadySettled: false,
      });
      // The player walks away (or any later state); the old intent still settles to the same one.
      await move(who.character.id, STILLREACH);
      const replay = await use(who, stackId, 3, intentId);
      expect(replay.teleport).toMatchObject({ status: "teleported", alreadySettled: true });
      expect(await locationOf(who)).toBe(STILLREACH);
      expect(await held(who)).toBe(2);
      expect(await receipts(who)).toHaveLength(1);
    });

    it("concurrent requests with one intent teleport once", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 5);
      const intentId = crypto.randomUUID();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => use(who, stackId, 5, intentId)),
      );
      expect(results.filter((r) => r.teleport.status === "teleported")).toHaveLength(6);
      expect(
        results.filter((r) => r.teleport.status === "teleported" && !r.teleport.alreadySettled),
      ).toHaveLength(1);
      expect(await held(who)).toBe(4);
      expect(await receipts(who)).toHaveLength(1);
    });

    it("two tabs with different intents cannot over-spend", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 5);
      const results = await Promise.all(Array.from({ length: 4 }, () => use(who, stackId, 5)));
      const wins = results.filter((r) => r.teleport.status === "teleported");
      expect(wins).toHaveLength(1);
      expect(results.filter((r) => r.teleport.status === "refused")).toHaveLength(3);
      expect(await held(who)).toBe(4);
      expect(await receipts(who)).toHaveLength(1);
      expect(await locationOf(who)).toBe(CRASH_SITE);
    });

    it("a lone last rune cannot be spent twice from different tabs", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 1);
      const results = await Promise.all([use(who, stackId, 1), use(who, stackId, 1)]);
      expect(results.filter((r) => r.teleport.status === "teleported")).toHaveLength(1);
      expect(await held(who)).toBe(0);
    });
  });

  describe("the durable arrival receipt", () => {
    it("survives re-reads until acknowledged, and acknowledgment is presentation only", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 2);
      await use(who, stackId, 2);
      const reread = await play.getPlayGameplayState(who.userId, who.character.id, start, quiet());
      expect(reread.runeTeleport.arrival).toMatchObject({ name: "Crash Site" });
      const intentId = reread.runeTeleport.arrival!.intentId;

      const before = await untouched(who);
      const acknowledged = await commands.acknowledgeRuneTeleportArrival(
        who.userId,
        who.character.id,
        intentId,
        start,
      );
      expect(acknowledged.runeTeleport.arrival).toBeUndefined();
      // Idempotent: a repeat or a second device changes nothing.
      await commands.acknowledgeRuneTeleportArrival(who.userId, who.character.id, intentId, start);
      expect(await untouched(who)).toEqual(before);
      expect(await held(who)).toBe(1);
      expect(await locationOf(who)).toBe(CRASH_SITE);
      expect(await receipts(who)).toHaveLength(1);
    });

    it("a later teleport issues a fresh arrival", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 2);
      const first = await use(who, stackId, 2);
      await commands.acknowledgeRuneTeleportArrival(
        who.userId,
        who.character.id,
        first.state.runeTeleport.arrival!.intentId,
        start,
      );
      await move(who.character.id, STILLREACH);
      const second = await use(who, stackId, 1);
      expect(second.state.runeTeleport.arrival?.arrivedAt).toBeTruthy();
    });

    it("a stale tab cannot acknowledge a newer teleport arrival", async () => {
      const who = await player(STILLREACH);
      const stackId = await give(who, 2);
      const first = await use(who, stackId, 2);
      const staleIntentId = first.state.runeTeleport.arrival!.intentId;

      // Another tab dismissed Arrival 1 and made a fresh teleport.
      await commands.acknowledgeRuneTeleportArrival(
        who.userId,
        who.character.id,
        staleIntentId,
        start,
      );
      await move(who.character.id, STILLREACH);
      const second = await use(who, stackId, 1);
      const currentIntentId = second.state.runeTeleport.arrival!.intentId;
      expect(currentIntentId).not.toBe(staleIntentId);
      const before = await untouched(who);

      // This old tab still shows Arrival 1, not the newer arrival.
      const staleDismissal = await commands.acknowledgeRuneTeleportArrival(
        who.userId,
        who.character.id,
        staleIntentId,
        start,
      );
      expect(staleDismissal.runeTeleport.arrival?.intentId).toBe(currentIntentId);
      const rows = await receipts(who);
      expect(
        rows.find((row) => row.intentId === currentIntentId)?.arrivalAcknowledgedAt,
      ).toBeNull();
      expect(await untouched(who)).toEqual(before);
      expect(await held(who)).toBe(0);
      expect(await locationOf(who)).toBe(CRASH_SITE);

      // Only dismissing the current receipt clears the current arrival.
      const dismissed = await commands.acknowledgeRuneTeleportArrival(
        who.userId,
        who.character.id,
        currentIntentId,
        start,
      );
      expect(dismissed.runeTeleport.arrival).toBeUndefined();
    });

    it("is still acknowledgeable while trade-engaged or in flight", async () => {
      const who = await player(STILLREACH);
      const other = await player(STILLREACH);
      const stackId = await give(who, 1);
      const teleported = await use(who, stackId, 1);
      await trades.createTradeRequest(
        who.userId,
        who.character.id,
        { characterId: other.character.id },
        start,
      );
      const state = await commands.acknowledgeRuneTeleportArrival(
        who.userId,
        who.character.id,
        teleported.state.runeTeleport.arrival!.intentId,
        start,
      );
      expect(state.runeTeleport.arrival).toBeUndefined();
    });
  });

  describe("a traded rune", () => {
    function ok(result: TradeCommandResult): TradeStateView {
      if (result.status !== "ok") throw new Error(`expected ok, got ${result.reason}`);
      return result.state;
    }
    const version = async (sessionId: string) => {
      const [row] = await db
        .select({ offerVersion: rune.playerTradeSessions.offerVersion })
        .from(rune.playerTradeSessions)
        .where(eq(rune.playerTradeSessions.id, sessionId));
      return row!.offerVersion;
    };

    it("works for the receiving character, who has no Rig, Mission or visit", async () => {
      const a = await player(STILLREACH);
      const b = await player(STILLREACH);
      await give(a, 2);
      const sent = ok(
        await trades.createTradeRequest(
          a.userId,
          a.character.id,
          { characterId: b.character.id },
          start,
        ),
      );
      const session = ok(
        await trades.acceptTradeRequest(b.userId, b.character.id, sent.outgoing!.id, start),
      ).session!.id;
      ok(
        await trades.addTradeOfferStack(
          a.userId,
          a.character.id,
          session,
          await version(session),
          RUNE,
          1,
          start,
        ),
      );
      for (const who of [a, b]) {
        ok(
          await trades.readyTradeOffer(
            who.userId,
            who.character.id,
            session,
            await version(session),
            start,
          ),
        );
      }
      for (const who of [a, b]) {
        ok(
          await trades.confirmTrade(
            who.userId,
            who.character.id,
            session,
            await version(session),
            start,
          ),
        );
      }
      expect(await held(a)).toBe(1);
      expect(await held(b)).toBe(1);

      const [stack] = await db
        .select()
        .from(rune.inventoryStacks)
        .where(
          and(
            eq(rune.inventoryStacks.characterId, b.character.id),
            eq(rune.inventoryStacks.itemId, RUNE),
          ),
        );
      const result = await use(b, stack!.id, 1);
      expect(result.teleport.status).toBe("teleported");
      expect(await locationOf(b)).toBe(CRASH_SITE);
      expect(await locationOf(a)).toBe(STILLREACH);
    });
  });
});
