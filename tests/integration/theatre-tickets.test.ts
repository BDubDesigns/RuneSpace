import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ACTION_IDS,
  LOCATION_IDS,
  SKILL_IDS,
  THEATRE_FILM_IDS,
  THEATRE_SCREEN_IDS,
  THEATRE_TICKET_TIER_IDS,
} from "@/game/config/foundations";
import { getTheatreScreen } from "@/game/content/theatre";
import { showingAt } from "@/game/domain/theatre";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #491, slice 2 — the Holo Drive-In ticket purchase against real PostgreSQL.
 *
 * What only the database proves: that Credit debit, receipt, replay pointer and buff top-up
 * commit or roll back as one; that simultaneous tabs, double taps and retries mint exactly one
 * ticket and charge exactly once; that the half-open UTC boundary belongs to the incoming
 * showing; that the unique (character, film, showtime) index and the table CHECKs are real;
 * and that nothing about a refusal is left behind. No browser and no UI: the purchase is not
 * reachable by players in this slice.
 */
suite("issue #491 Holo Drive-In tickets (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let commands: typeof import("@/server/theatre-commands");
  let theatre: typeof import("@/server/theatre");
  const createdUsers: string[] = [];
  const deterministicRandom = { nextBasisPoints: () => 0, nextUnit: () => 0 };

  const MINES = THEATRE_FILM_IDS.thatMinesMine;
  const WELD = THEATRE_FILM_IDS.rareOrWeldDone;
  const FILM_TIER = THEATRE_TICKET_TIER_IDS.film;
  const COMBO_TIER = THEATRE_TICKET_TIER_IDS.concessions;
  const screen = getTheatreScreen(THEATRE_SCREEN_IDS.main)!;
  const at = (iso: string) => new Date(iso);
  const showing = (iso: string) => showingAt(screen, Date.parse(iso));
  // 18:00 UTC is an even hour (That Mines Mine!), 19:00 odd (Rare or Weld Done?).
  const T18 = "2026-11-06T18:30:00.000Z";
  const T19 = "2026-11-06T19:30:00.000Z";
  const T20 = "2026-11-06T20:30:00.000Z";

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    commands = await import("@/server/theatre-commands");
    theatre = await import("@/server/theatre");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter(options?: { credits?: number; locationId?: string }) {
    const userId = await createTestUser(db, authSchema, "Theatre Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Show ${userId.slice(0, 8)}`,
      undefined,
      { seedLegacyStarterCutter: false },
    );
    await play.getPlayGameplayState(userId, character.id, at(T18), deterministicRandom);
    await db
      .update(rune.characters)
      .set({
        credits: options?.credits ?? 500,
        currentLocationId: options?.locationId ?? LOCATION_IDS.holoDriveIn,
      })
      .where(eq(rune.characters.id, character.id));
    return { userId, characterId: character.id };
  }

  async function snapshot(characterId: string) {
    const [row] = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId));
    const receipts = await db
      .select()
      .from(rune.characterTheatreReceipts)
      .where(eq(rune.characterTheatreReceipts.characterId, characterId));
    const pointers = await db
      .select()
      .from(rune.characterTheatreLatestTickets)
      .where(eq(rune.characterTheatreLatestTickets.characterId, characterId));
    const buffs = await db
      .select()
      .from(rune.characterTheatreBuffs)
      .where(eq(rune.characterTheatreBuffs.characterId, characterId));
    return {
      credits: row!.credits,
      receipts,
      pointers,
      buffs: Object.fromEntries(buffs.map((buff) => [buff.skillId, buff.remainingCharges])),
    };
  }

  async function setBuff(characterId: string, skillId: string, remaining: number) {
    await db.insert(rune.characterTheatreBuffs).values({
      characterId,
      skillId,
      remainingCharges: remaining,
      updatedAt: at(T18),
    });
  }

  function buy(
    who: { userId: string; characterId: string },
    iso: string,
    tierId: string = FILM_TIER,
    showingIso: string = iso,
  ) {
    return commands.buyTheatreTicket(
      who.userId,
      who.characterId,
      { showingId: showing(showingIso).showingId, tierId },
      at(iso),
    );
  }

  describe("a successful purchase", () => {
    it("debits 20 Credits and writes the receipt, the replay pointer and a 20-charge Mining buff together", async () => {
      const who = await makeCharacter({ credits: 100 });
      const result = await buy(who, T18);
      const live = showing(T18);
      expect(result.purchase).toMatchObject({
        status: "purchased",
        showingId: live.showingId,
        showtimeId: "2026-11-06T18:00:00.000Z",
        filmId: MINES,
        tierId: FILM_TIER,
        skillId: SKILL_IDS.mining,
        creditsPaid: 20,
        credits: 80,
        buff: { remainingBefore: 0, remainingAfter: 20, added: 20, outcome: "fills" },
      });
      // The Play state the command returns carries the new balance.
      expect(result.state.credits).toBe(80);

      const state = await snapshot(who.characterId);
      expect(state.credits).toBe(80);
      expect(state.receipts).toHaveLength(1);
      expect(state.receipts[0]).toMatchObject({
        filmId: MINES,
        showtimeId: "2026-11-06T18:00:00.000Z",
        screenId: THEATRE_SCREEN_IDS.main,
        showingId: live.showingId,
        tierId: FILM_TIER,
        skillId: SKILL_IDS.mining,
        creditsPaid: 20,
        tierCapacity: 20,
        chargesBefore: 0,
        chargesAfter: 20,
      });
      expect(state.pointers).toHaveLength(1);
      expect(state.pointers[0]).toMatchObject({
        receiptId: state.receipts[0]!.id,
        filmId: MINES,
        showtimeId: "2026-11-06T18:00:00.000Z",
      });
      expect(state.buffs).toEqual({ [SKILL_IDS.mining]: 20 });
    });

    it("sells the 50-Credit concessions ticket as a 50-charge buff and 50 Credits, nothing else", async () => {
      const who = await makeCharacter({ credits: 60 });
      const result = await buy(who, T18, COMBO_TIER);
      expect(result.purchase).toMatchObject({
        status: "purchased",
        tierId: COMBO_TIER,
        creditsPaid: 50,
        credits: 10,
        buff: { remainingAfter: 50, added: 50 },
      });
      const state = await snapshot(who.characterId);
      expect(state.credits).toBe(10);
      expect(state.buffs).toEqual({ [SKILL_IDS.mining]: 50 });
      // Concessions are a bundle, not an item: no inventory row was created.
      const stacks = await db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, who.characterId));
      expect(stacks.filter((stack) => stack.itemId.includes("popcorn"))).toEqual([]);
    });

    it("grants the Welding buff for the Welding film, leaving Mining alone", async () => {
      const who = await makeCharacter();
      await setBuff(who.characterId, SKILL_IDS.mining, 7);
      const result = await buy(who, T19);
      expect(result.purchase).toMatchObject({
        status: "purchased",
        filmId: WELD,
        skillId: SKILL_IDS.welding,
        buff: { remainingBefore: 0, remainingAfter: 20 },
      });
      expect((await snapshot(who.characterId)).buffs).toEqual({
        [SKILL_IDS.mining]: 7,
        [SKILL_IDS.welding]: 20,
      });
    });

    it("lets both skill buffs be bought and held independently, one showing at a time", async () => {
      const who = await makeCharacter();
      await buy(who, T18, COMBO_TIER);
      await buy(who, T19, FILM_TIER);
      const state = await snapshot(who.characterId);
      expect(state.buffs).toEqual({ [SKILL_IDS.mining]: 50, [SKILL_IDS.welding]: 20 });
      expect(state.receipts.map((receipt) => receipt.filmId).sort()).toEqual([MINES, WELD].sort());
      expect(state.credits).toBe(500 - 50 - 20);
    });

    it("does not touch inventory, location or the ship", async () => {
      const who = await makeCharacter();
      const before = await db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, who.characterId));
      const result = await buy(who, T18);
      expect(result.state.location.currentLocationId).toBe(LOCATION_IDS.holoDriveIn);
      const after = await db
        .select()
        .from(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, who.characterId));
      expect(after).toEqual(before);
    });
  });

  describe("one receipt per character, film and showtime", () => {
    it("refuses a same-show rebuy, an upgrade and a downgrade, charging and granting nothing", async () => {
      const who = await makeCharacter();
      await buy(who, T18, FILM_TIER);
      const before = await snapshot(who.characterId);

      for (const tierId of [FILM_TIER, COMBO_TIER]) {
        const retry = await buy(who, "2026-11-06T18:45:00.000Z", tierId, T18);
        expect(retry.purchase).toMatchObject({
          status: "refused",
          reason: "already_purchased",
          heldTierId: FILM_TIER,
        });
      }
      expect(await snapshot(who.characterId)).toEqual(before);
    });

    it("refuses a rebuy even after the charges have all been spent", async () => {
      const who = await makeCharacter();
      await buy(who, T18, FILM_TIER);
      await db
        .update(rune.characterTheatreBuffs)
        .set({ remainingCharges: 0 })
        .where(
          and(
            eq(rune.characterTheatreBuffs.characterId, who.characterId),
            eq(rune.characterTheatreBuffs.skillId, SKILL_IDS.mining),
          ),
        );
      const before = await snapshot(who.characterId);
      const retry = await buy(who, "2026-11-06T18:59:00.000Z", COMBO_TIER, T18);
      expect(retry.purchase).toMatchObject({ status: "refused", reason: "already_purchased" });
      expect(await snapshot(who.characterId)).toEqual(before);
      expect(before.buffs[SKILL_IDS.mining]).toBe(0);
    });

    it("lets the same film be bought again in a later showing, as a new opportunity", async () => {
      const who = await makeCharacter();
      await buy(who, T18, FILM_TIER);
      const later = await buy(who, T20, FILM_TIER);
      expect(later.purchase).toMatchObject({ status: "purchased", filmId: MINES });
      const state = await snapshot(who.characterId);
      expect(state.receipts).toHaveLength(2);
      expect(new Set(state.receipts.map((receipt) => receipt.showtimeId)).size).toBe(2);
    });

    it("keeps one character's receipts from blocking another's", async () => {
      const first = await makeCharacter();
      const second = await makeCharacter();
      await buy(first, T18);
      const other = await buy(second, T18);
      expect(other.purchase.status).toBe("purchased");
    });
  });

  describe("the buff top-up", () => {
    it.each([
      // existing remaining, tier, expected after, expected added
      [30, FILM_TIER, 30, 0],
      [30, COMBO_TIER, 50, 20],
      [5, FILM_TIER, 20, 15],
      [0, FILM_TIER, 20, 20],
      [50, FILM_TIER, 50, 0],
      [200, COMBO_TIER, 200, 0],
    ] as const)("%i remaining + %s -> %i (adds %i)", async (existing, tierId, after, added) => {
      const who = await makeCharacter();
      if (existing > 0) await setBuff(who.characterId, SKILL_IDS.mining, existing);
      const result = await buy(who, T18, tierId);
      expect(result.purchase).toMatchObject({
        status: "purchased",
        buff: { remainingBefore: existing, remainingAfter: after, added },
      });
      const state = await snapshot(who.characterId);
      expect(state.buffs[SKILL_IDS.mining]).toBe(after);
      // A ticket that adds nothing still charges, and still buys the receipt and the replay.
      expect(state.receipts).toHaveLength(1);
      expect(state.pointers).toHaveLength(1);
      expect(state.credits).toBe(500 - (tierId === FILM_TIER ? 20 : 50));
    });

    it("never sums across showings: 40 remaining + a 50 ticket at the next showing is 50", async () => {
      const who = await makeCharacter();
      await buy(who, T18, COMBO_TIER);
      await db
        .update(rune.characterTheatreBuffs)
        .set({ remainingCharges: 40 })
        .where(eq(rune.characterTheatreBuffs.characterId, who.characterId));
      const later = await buy(who, T20, COMBO_TIER);
      expect(later.purchase).toMatchObject({ buff: { remainingBefore: 40, remainingAfter: 50 } });
      expect((await snapshot(who.characterId)).buffs[SKILL_IDS.mining]).toBe(50);
    });

    it("records what the purchase actually did, so it stays auditable", async () => {
      const who = await makeCharacter();
      await setBuff(who.characterId, SKILL_IDS.mining, 30);
      await buy(who, T18, FILM_TIER);
      const [receipt] = (await snapshot(who.characterId)).receipts;
      expect(receipt).toMatchObject({
        creditsPaid: 20,
        tierCapacity: 20,
        chargesBefore: 30,
        chargesAfter: 30,
      });
    });
  });

  describe("the half-open UTC boundary", () => {
    it("sells the outgoing film up to the last millisecond and the incoming film from the hour", async () => {
      const who = await makeCharacter();
      const lastMs = "2026-11-06T18:59:59.999Z";
      const outgoing = await buy(who, lastMs, FILM_TIER, lastMs);
      expect(outgoing.purchase).toMatchObject({ status: "purchased", filmId: MINES });

      const boundary = "2026-11-06T19:00:00.000Z";
      const incoming = await buy(who, boundary, FILM_TIER, boundary);
      expect(incoming.purchase).toMatchObject({ status: "purchased", filmId: WELD });
      expect((await snapshot(who.characterId)).receipts).toHaveLength(2);
    });

    it("refuses an outgoing-film request that reaches the server at the boundary, and buys nothing", async () => {
      const who = await makeCharacter();
      const before = await snapshot(who.characterId);
      const stale = await buy(
        who,
        "2026-11-06T19:00:00.000Z",
        FILM_TIER,
        "2026-11-06T18:59:59.999Z",
      );
      expect(stale.purchase).toMatchObject({ status: "refused", reason: "showing_changed" });
      expect(await snapshot(who.characterId)).toEqual(before);
    });

    it("keeps the latest ticket, the receipt and the buff across the turnover", async () => {
      const who = await makeCharacter();
      await buy(who, "2026-11-06T18:59:59.999Z", COMBO_TIER, "2026-11-06T18:59:59.999Z");
      // Hours later, a fresh read finds all of it: nothing expires with the programme.
      const [later] = await db.transaction(async (transaction) => [
        await theatre.loadCharacterTheatreState(transaction, who.characterId),
      ]);
      expect(later!.buffs[SKILL_IDS.mining]).toBe(50);
      expect(later!.latestTicket).toMatchObject({
        filmId: MINES,
        showtimeId: "2026-11-06T18:00:00.000Z",
        tierId: COMBO_TIER,
      });
      expect(later!.receipts).toHaveLength(1);
    });
  });

  describe("refusals mutate nothing", () => {
    async function expectRefusal(
      who: { userId: string; characterId: string },
      run: () => ReturnType<typeof buy>,
      reason: string,
    ) {
      const before = await snapshot(who.characterId);
      const result = await run();
      expect(result.purchase).toMatchObject({ status: "refused", reason });
      expect(await snapshot(who.characterId)).toEqual(before);
    }

    it("refuses what the character cannot afford: 19 Credits for a 20 ticket, 49 for a 50", async () => {
      const poor = await makeCharacter({ credits: 19 });
      await expectRefusal(poor, () => buy(poor, T18, FILM_TIER), "insufficient_credits");
      const almost = await makeCharacter({ credits: 49 });
      await expectRefusal(almost, () => buy(almost, T18, COMBO_TIER), "insufficient_credits");
      // Exactly enough is enough.
      const exact = await makeCharacter({ credits: 20 });
      expect((await buy(exact, T18, FILM_TIER)).purchase.status).toBe("purchased");
      expect((await snapshot(exact.characterId)).credits).toBe(0);
    });

    it("refuses a character who is not at the Holo Drive-In", async () => {
      const away = await makeCharacter({ locationId: LOCATION_IDS.holoHollow });
      await expectRefusal(away, () => buy(away, T18), "not_at_theatre");
    });

    it("refuses an unknown ticket and a made-up showing", async () => {
      const who = await makeCharacter();
      await expectRefusal(who, () => buy(who, T18, "vip_box"), "unknown_tier");
      await expectRefusal(
        who,
        () =>
          commands.buyTheatreTicket(
            who.userId,
            who.characterId,
            { showingId: "holo_drive_in_main@2026-11-06T04:00:00.000Z", tierId: FILM_TIER },
            at(T18),
          ),
        "showing_changed",
      );
    });

    it("refuses a character walking away, since they are not at the theatre but on the way", async () => {
      const who = await makeCharacter();
      const begun = await play.beginTravel(
        who.userId,
        who.characterId,
        LOCATION_IDS.holoHollow,
        at(T18),
      );
      expect(begun.travelError).toBeUndefined();
      await expectRefusal(who, () => buy(who, T18), "in_transit");
    });

    it("refuses a character busy with another activity", async () => {
      const who = await makeCharacter();
      await db.insert(rune.activeActions).values({
        characterId: who.characterId,
        actionId: ACTION_IDS.ferriteShaleMining,
        startedAt: at(T18),
        resolvedThroughAt: at(T18),
      });
      await expectRefusal(who, () => buy(who, T18), "active_action");
    });

    it("refuses a character that belongs to somebody else", async () => {
      const owner = await makeCharacter();
      const stranger = await makeCharacter();
      const before = await snapshot(owner.characterId);
      await expect(
        commands.buyTheatreTicket(
          stranger.userId,
          owner.characterId,
          { showingId: showing(T18).showingId, tierId: FILM_TIER },
          at(T18),
        ),
      ).rejects.toThrow();
      expect(await snapshot(owner.characterId)).toEqual(before);
    });
  });

  describe("atomicity", () => {
    it("rolls the debit, the receipt and the replay pointer back when the buff grant fails", async () => {
      const who = await makeCharacter();
      const trigger = `theatre_buff_failure_${who.characterId.replaceAll("-", "_")}`;
      await db.execute(
        sql.raw(`
          CREATE FUNCTION ${trigger}() RETURNS trigger AS $$
          BEGIN
            RAISE EXCEPTION 'simulated buff failure';
          END;
          $$ LANGUAGE plpgsql
        `),
      );
      await db.execute(
        sql.raw(`
          CREATE TRIGGER ${trigger} BEFORE INSERT ON character_theatre_buffs
          FOR EACH ROW WHEN (NEW.character_id = '${who.characterId}')
          EXECUTE FUNCTION ${trigger}()
        `),
      );
      try {
        const before = await snapshot(who.characterId);
        await expect(buy(who, T18)).rejects.toThrow();
        // Nothing of the purchase survived: not the charge, not the receipt, not the replay.
        expect(await snapshot(who.characterId)).toEqual(before);
        expect(before.receipts).toEqual([]);
        expect(before.pointers).toEqual([]);
        expect(before.buffs).toEqual({});
      } finally {
        await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON character_theatre_buffs`));
        await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${trigger}()`));
      }
      // With the fault gone, the same purchase goes through whole.
      const retry = await buy(who, T18);
      expect(retry.purchase.status).toBe("purchased");
      const after = await snapshot(who.characterId);
      expect(after.credits).toBe(480);
      expect(after.receipts).toHaveLength(1);
      expect(after.buffs).toEqual({ [SKILL_IDS.mining]: 20 });
    });

    it("rolls everything back when the replay pointer cannot be written", async () => {
      const who = await makeCharacter();
      const trigger = `theatre_pointer_failure_${who.characterId.replaceAll("-", "_")}`;
      await db.execute(
        sql.raw(`
          CREATE FUNCTION ${trigger}() RETURNS trigger AS $$
          BEGIN
            RAISE EXCEPTION 'simulated pointer failure';
          END;
          $$ LANGUAGE plpgsql
        `),
      );
      await db.execute(
        sql.raw(`
          CREATE TRIGGER ${trigger} BEFORE INSERT ON character_theatre_latest_tickets
          FOR EACH ROW WHEN (NEW.character_id = '${who.characterId}')
          EXECUTE FUNCTION ${trigger}()
        `),
      );
      try {
        const before = await snapshot(who.characterId);
        await expect(buy(who, T18)).rejects.toThrow();
        expect(await snapshot(who.characterId)).toEqual(before);
        expect(before.receipts).toEqual([]);
        expect(before.credits).toBe(500);
      } finally {
        await db.execute(
          sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON character_theatre_latest_tickets`),
        );
        await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${trigger}()`));
      }
    });
  });

  describe("concurrency and retries", () => {
    it("mints exactly one ticket and charges once for five simultaneous identical requests", async () => {
      const who = await makeCharacter({ credits: 100 });
      const results = await Promise.all(Array.from({ length: 5 }, () => buy(who, T18)));
      const purchased = results.filter((result) => result.purchase.status === "purchased");
      const refused = results.filter((result) => result.purchase.status === "refused");
      expect(purchased).toHaveLength(1);
      expect(refused).toHaveLength(4);
      for (const result of refused) {
        expect(result.purchase).toMatchObject({
          reason: "already_purchased",
          heldTierId: FILM_TIER,
        });
      }
      const state = await snapshot(who.characterId);
      expect(state.credits).toBe(80);
      expect(state.receipts).toHaveLength(1);
      expect(state.pointers).toHaveLength(1);
      expect(state.buffs).toEqual({ [SKILL_IDS.mining]: 20 });
    });

    it("lets one of two simultaneous different tiers win and never both", async () => {
      const who = await makeCharacter({ credits: 200 });
      const results = await Promise.all([buy(who, T18, FILM_TIER), buy(who, T18, COMBO_TIER)]);
      expect(results.filter((result) => result.purchase.status === "purchased")).toHaveLength(1);
      const state = await snapshot(who.characterId);
      expect(state.receipts).toHaveLength(1);
      const paid = state.receipts[0]!.creditsPaid;
      expect(state.credits).toBe(200 - paid);
      expect(state.buffs[SKILL_IDS.mining]).toBe(state.receipts[0]!.tierCapacity);
    });

    it("never overdraws: racing requests for one showing with Credits for a single ticket buy one", async () => {
      const who = await makeCharacter({ credits: 30 });
      // 30 Credits covers the 20 ticket and not the 50 one; whichever request the lock admits
      // first, exactly one purchase can commit and the balance never goes negative.
      const results = await Promise.all([
        buy(who, T18, FILM_TIER),
        buy(who, T18, FILM_TIER),
        buy(who, T18, COMBO_TIER),
      ]);
      expect(results.filter((result) => result.purchase.status === "purchased").length).toBe(1);
      const state = await snapshot(who.characterId);
      expect(state.credits).toBeGreaterThanOrEqual(0);
      expect(state.receipts).toHaveLength(1);
    });

    it("treats a retry after a lost response as the purchase it already was", async () => {
      const who = await makeCharacter();
      const first = await buy(who, T18, COMBO_TIER);
      expect(first.purchase.status).toBe("purchased");
      // The response never arrived; the client asks again for the same showing and tier.
      const again = await buy(who, "2026-11-06T18:31:00.000Z", COMBO_TIER, T18);
      expect(again.purchase).toMatchObject({
        status: "refused",
        reason: "already_purchased",
        heldTierId: COMBO_TIER,
      });
      const state = await snapshot(who.characterId);
      expect(state.credits).toBe(450);
      expect(state.receipts).toHaveLength(1);
    });

    it("refuses a simultaneous request naming the other hour's showing as stale, buying only the real one", async () => {
      const who = await makeCharacter();
      // At one instant only one showing is on; a request for the next hour's is stale.
      const [mining, welding] = await Promise.all([
        buy(who, T18, FILM_TIER, T18),
        buy(who, T18, FILM_TIER, T19),
      ]);
      expect(mining.purchase.status).toBe("purchased");
      expect(welding.purchase).toMatchObject({ status: "refused", reason: "showing_changed" });
      expect((await snapshot(who.characterId)).receipts).toHaveLength(1);
    });
  });

  describe("the latest ticket (replay entitlement)", () => {
    it("points at the most recent purchase, replacing the last, while every receipt stays", async () => {
      const who = await makeCharacter();
      await buy(who, T18);
      const second = await buy(who, T19);
      const state = await snapshot(who.characterId);
      expect(state.pointers).toHaveLength(1);
      expect(state.receipts).toHaveLength(2);
      expect(state.pointers[0]).toMatchObject({
        filmId: WELD,
        showtimeId: "2026-11-06T19:00:00.000Z",
      });
      expect(second.purchase.status === "purchased" && second.purchase.receiptId).toBe(
        state.pointers[0]!.receiptId,
      );
      const loaded = await db.transaction((transaction) =>
        theatre.loadLatestTheatreTicket(transaction, who.characterId),
      );
      expect(loaded).toMatchObject({ filmId: WELD, tierId: FILM_TIER });
    });

    it("is not replaced by a refused purchase, and is empty for a character who never bought", async () => {
      const who = await makeCharacter();
      expect(
        await db.transaction((transaction) =>
          theatre.loadLatestTheatreTicket(transaction, who.characterId),
        ),
      ).toBeUndefined();
      await buy(who, T18);
      await buy(who, T18, COMBO_TIER); // refused: already purchased
      const loaded = await db.transaction((transaction) =>
        theatre.loadLatestTheatreTicket(transaction, who.characterId),
      );
      expect(loaded).toMatchObject({ filmId: MINES, tierId: FILM_TIER });
    });

    it("survives travel: the entitlement is kept while the character is elsewhere", async () => {
      const who = await makeCharacter();
      await buy(who, T18);
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.crashSite })
        .where(eq(rune.characters.id, who.characterId));
      const loaded = await db.transaction((transaction) =>
        theatre.loadLatestTheatreTicket(transaction, who.characterId),
      );
      expect(loaded).toMatchObject({ filmId: MINES });
      // Away from the theatre, a purchase is refused but the entitlement and buff are untouched.
      const refused = await buy(who, T19);
      expect(refused.purchase).toMatchObject({ reason: "not_at_theatre" });
      expect((await snapshot(who.characterId)).buffs[SKILL_IDS.mining]).toBe(20);
    });
  });

  describe("the Play state's programme", () => {
    it("carries the showing and Up Next decided from the server's clock", async () => {
      const who = await makeCharacter();
      const even = await play.getPlayGameplayState(who.userId, who.characterId, at(T18));
      expect(even.theatre.screens[0]).toMatchObject({
        screenId: THEATRE_SCREEN_IDS.main,
        locationId: LOCATION_IDS.holoDriveIn,
        now: {
          filmId: MINES,
          startsAt: "2026-11-06T18:00:00.000Z",
          endsAt: "2026-11-06T19:00:00.000Z",
        },
        next: { filmId: WELD, startsAt: "2026-11-06T19:00:00.000Z" },
      });
      const odd = await play.getPlayGameplayState(who.userId, who.characterId, at(T19));
      expect(odd.theatre.screens[0]).toMatchObject({
        now: { filmId: WELD },
        next: { filmId: MINES },
      });
    });
  });

  describe("the tables' own constraints", () => {
    const receipt = (characterId: string, overrides: Record<string, unknown> = {}) => ({
      characterId,
      filmId: MINES,
      showtimeId: "2026-11-06T18:00:00.000Z",
      screenId: THEATRE_SCREEN_IDS.main,
      showingId: `${THEATRE_SCREEN_IDS.main}@2026-11-06T18:00:00.000Z`,
      tierId: FILM_TIER,
      skillId: SKILL_IDS.mining,
      creditsPaid: 20,
      tierCapacity: 20,
      chargesBefore: 0,
      chargesAfter: 20,
      purchasedAt: at(T18),
      ...overrides,
    });

    it("enforces one receipt per character, film and showtime in the index itself", async () => {
      const who = await makeCharacter();
      await db.insert(rune.characterTheatreReceipts).values(receipt(who.characterId));
      await expect(
        db
          .insert(rune.characterTheatreReceipts)
          .values(receipt(who.characterId, { tierId: COMBO_TIER, showingId: "another_screen@x" })),
      ).rejects.toThrow();
      // A different film in the same showtime, and the same film in another, are fine.
      await db
        .insert(rune.characterTheatreReceipts)
        .values(receipt(who.characterId, { filmId: WELD, skillId: SKILL_IDS.welding }));
      await db
        .insert(rune.characterTheatreReceipts)
        .values(receipt(who.characterId, { showtimeId: "2026-11-06T20:00:00.000Z" }));
    });

    it("rejects a receipt that could not describe a real purchase", async () => {
      const who = await makeCharacter();
      for (const bad of [
        { creditsPaid: 0 },
        { tierCapacity: 0 },
        { chargesBefore: -1 },
        { chargesBefore: 30, chargesAfter: 20 },
        { chargesAfter: 10 },
      ]) {
        await expect(
          db.insert(rune.characterTheatreReceipts).values(receipt(who.characterId, bad)),
        ).rejects.toThrow();
      }
    });

    it("allows one replay pointer per character and no negative buff", async () => {
      const who = await makeCharacter();
      const [row] = await db
        .insert(rune.characterTheatreReceipts)
        .values(receipt(who.characterId))
        .returning({ id: rune.characterTheatreReceipts.id });
      await db.insert(rune.characterTheatreLatestTickets).values({
        characterId: who.characterId,
        receiptId: row!.id,
        filmId: MINES,
        showtimeId: "2026-11-06T18:00:00.000Z",
        updatedAt: at(T18),
      });
      await expect(
        db.insert(rune.characterTheatreLatestTickets).values({
          characterId: who.characterId,
          receiptId: row!.id,
          filmId: MINES,
          showtimeId: "2026-11-06T18:00:00.000Z",
          updatedAt: at(T18),
        }),
      ).rejects.toThrow();
      await expect(
        db.insert(rune.characterTheatreBuffs).values({
          characterId: who.characterId,
          skillId: SKILL_IDS.mining,
          remainingCharges: -1,
          updatedAt: at(T18),
        }),
      ).rejects.toThrow();
      // The replay pointer's receipt cannot be deleted from under it.
      await expect(
        db
          .delete(rune.characterTheatreReceipts)
          .where(eq(rune.characterTheatreReceipts.id, row!.id)),
      ).rejects.toThrow();
    });
  });
});
