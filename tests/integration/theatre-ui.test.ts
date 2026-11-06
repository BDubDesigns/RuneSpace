import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  LOCATION_IDS,
  SKILL_IDS,
  THEATRE_FILM_IDS,
  THEATRE_SCREEN_IDS,
  THEATRE_TICKET_TIER_IDS,
} from "@/game/config/foundations";
import { PRE_ROLL_DURATION_MS, getTheatreScreen } from "@/game/content/theatre";
import { showingAt } from "@/game/domain/theatre";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #491, slice 4 — what the theatre UI reads and asks, against real PostgreSQL: the
 * character's theatre facts in the Play state (buff balances, the replay entitlement, the ticket
 * held for what is showing now, the viewer the server offers) and the viewing command that every
 * Watch Film, Replay, Restart and in-viewer Replay asks. The purchase itself is proven in
 * theatre-tickets.test.ts; this file proves its results reach the Play state, and that the viewing
 * decision is made from the character's own row under the lock, charges and grants nothing, and
 * does not move with the schedule.
 */
suite("issue #491 theatre Play state and viewing (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let play: typeof import("@/server/play");
  let commands: typeof import("@/server/theatre-commands");
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

  const ENV_KEYS = ["RUNESPACE_THEATRE_STAND_IN_ADS", "RUNESPACE_THEATRE_STAND_IN_AD_MS"] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    play = await import("@/server/play");
    commands = await import("@/server/theatre-commands");
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeCharacter(options?: { credits?: number; locationId?: string }) {
    const userId = await createTestUser(db, authSchema, "Theatre UI Tester");
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Ui ${userId.slice(0, 8)}`,
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

  function stateAt(who: { userId: string; characterId: string }, iso: string) {
    return play.getPlayGameplayState(who.userId, who.characterId, at(iso), deterministicRandom);
  }

  function buy(
    who: { userId: string; characterId: string },
    iso: string,
    tierId: string = FILM_TIER,
  ) {
    return commands.buyTheatreTicket(
      who.userId,
      who.characterId,
      { showingId: showing(iso).showingId, tierId },
      at(iso),
    );
  }

  async function ledger(characterId: string) {
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
    return { credits: row!.credits, receipts, pointers, buffs };
  }

  describe("the character's theatre facts in the Play state", () => {
    it("are present at the Drive-In and empty for a character who has never bought a ticket", async () => {
      const who = await makeCharacter();
      const { theatre } = await stateAt(who, T18);
      expect(theatre.character).toEqual({
        buffs: {},
        heldTiers: {},
        viewer: { available: false, standInAds: false, preRollMs: PRE_ROLL_DURATION_MS },
      });
      expect(theatre.screens[0]?.now.filmId).toBe(MINES);
      expect(theatre.screens[0]?.next.filmId).toBe(WELD);
    });

    it("are absent anywhere else, while the programme itself is not", async () => {
      const who = await makeCharacter({ locationId: LOCATION_IDS.holoHollow });
      const { theatre } = await stateAt(who, T18);
      expect(theatre.character).toBeUndefined();
      expect(theatre.screens).toHaveLength(1);
    });

    it("carry a purchase straight into the buff balance, the held ticket and the replay entitlement", async () => {
      const who = await makeCharacter();
      const purchased = await buy(who, T18);
      expect(purchased.purchase.status).toBe("purchased");
      // The purchase's own returned state already shows it (the UI accepts that state)...
      const returned = purchased.state.theatre.character!;
      // ...and so does a fresh read.
      const fresh = (await stateAt(who, T18)).theatre.character!;
      for (const character of [returned, fresh]) {
        expect(character.buffs).toEqual({ [SKILL_IDS.mining]: 20 });
        expect(character.heldTiers).toEqual({ [showing(T18).showingId]: FILM_TIER });
        expect(character.latestTicket).toMatchObject({
          filmId: MINES,
          showtimeId: showing(T18).showtimeId,
          tierId: FILM_TIER,
        });
      }
    });

    it("reports a ticket that adds zero attempts as held, with the buff unchanged", async () => {
      const who = await makeCharacter();
      await db.insert(rune.characterTheatreBuffs).values({
        characterId: who.characterId,
        skillId: SKILL_IDS.mining,
        remainingCharges: 30,
        updatedAt: at(T18),
      });
      const result = await buy(who, T18, FILM_TIER);
      expect(result.purchase).toMatchObject({
        status: "purchased",
        buff: { remainingBefore: 30, remainingAfter: 30, added: 0, outcome: "adds_none" },
      });
      const character = (await stateAt(who, T18)).theatre.character!;
      expect(character.buffs[SKILL_IDS.mining]).toBe(30);
      expect(character.heldTiers[showing(T18).showingId]).toBe(FILM_TIER);
    });

    it("keep the balances and the entitlement across the hour, and hold nothing for the new showing", async () => {
      const who = await makeCharacter();
      await buy(who, T18, COMBO_TIER);
      const next = (await stateAt(who, T19)).theatre;
      expect(next.screens[0]?.now.filmId).toBe(WELD);
      expect(next.character).toMatchObject({
        buffs: { [SKILL_IDS.mining]: 50 },
        heldTiers: {},
        latestTicket: { filmId: MINES, showtimeId: showing(T18).showtimeId, tierId: COMBO_TIER },
      });
    });

    it("show both skills independently and a newer ticket replaces only the replay pointer", async () => {
      const who = await makeCharacter();
      await buy(who, T18, FILM_TIER);
      await buy(who, T19, COMBO_TIER);
      const character = (await stateAt(who, T19)).theatre.character!;
      expect(character.buffs).toEqual({ [SKILL_IDS.mining]: 20, [SKILL_IDS.welding]: 50 });
      expect(character.latestTicket).toMatchObject({ filmId: WELD, tierId: COMBO_TIER });
      expect(character.heldTiers).toEqual({ [showing(T19).showingId]: COMBO_TIER });
    });

    it("name the viewer the server offers: none in production, stand-ins and a shorter pre-roll on opt-in", async () => {
      const who = await makeCharacter();
      process.env.RUNESPACE_THEATRE_STAND_IN_ADS = "true";
      process.env.RUNESPACE_THEATRE_STAND_IN_AD_MS = "2500";
      expect((await stateAt(who, T18)).theatre.character?.viewer).toEqual({
        available: true,
        standInAds: true,
        preRollMs: 2500,
      });
      // A bad or out-of-range override falls back to the designed length, never to nothing.
      for (const bad of ["abc", "0", "-5", "499", "15001", "1.5", ""]) {
        process.env.RUNESPACE_THEATRE_STAND_IN_AD_MS = bad;
        expect((await stateAt(who, T18)).theatre.character?.viewer.preRollMs).toBe(
          PRE_ROLL_DURATION_MS,
        );
      }
      // The override means nothing without the opt-in.
      delete process.env.RUNESPACE_THEATRE_STAND_IN_ADS;
      process.env.RUNESPACE_THEATRE_STAND_IN_AD_MS = "2500";
      expect((await stateAt(who, T18)).theatre.character?.viewer).toEqual({
        available: false,
        standInAds: false,
        preRollMs: PRE_ROLL_DURATION_MS,
      });
    });
  });

  describe("authorizing a viewing", () => {
    function authorize(who: { userId: string; characterId: string }, iso: string = T18) {
      return commands.authorizeTheatreViewing(who.userId, who.characterId, at(iso));
    }

    it("refuses a character with no ticket", async () => {
      process.env.RUNESPACE_THEATRE_STAND_IN_ADS = "true";
      const who = await makeCharacter();
      expect((await authorize(who)).viewing).toEqual({
        status: "refused",
        reason: "no_ticket",
        message: "Buy a ticket to watch a film.",
      });
    });

    it("allows the ticket's film, and refuses while the viewer is not offered", async () => {
      const who = await makeCharacter();
      await buy(who, T18);
      // Production: no commercials, no viewer. The ticket, buff and receipt are untouched.
      expect((await authorize(who)).viewing).toMatchObject({
        status: "refused",
        reason: "unavailable",
      });
      process.env.RUNESPACE_THEATRE_STAND_IN_ADS = "true";
      expect((await authorize(who)).viewing).toEqual({
        status: "allowed",
        filmId: MINES,
        showtimeId: showing(T18).showtimeId,
        tierId: FILM_TIER,
      });
    });

    it("plays the ticket's film after the hour turns, never the film showing now", async () => {
      process.env.RUNESPACE_THEATRE_STAND_IN_ADS = "true";
      const who = await makeCharacter();
      await buy(who, T18);
      // 19:30 is Rare or Weld Done?; the viewing still belongs to the 18:00 ticket.
      expect((await authorize(who, T19)).viewing).toMatchObject({
        status: "allowed",
        filmId: MINES,
      });
      expect((await authorize(who, T20)).viewing).toMatchObject({
        status: "allowed",
        filmId: MINES,
      });
      // A newer ticket replaces which film an authorization names.
      await buy(who, T19, FILM_TIER);
      expect((await authorize(who, T20)).viewing).toMatchObject({
        status: "allowed",
        filmId: WELD,
      });
    });

    it("keeps the entitlement while the character is away but plays it only at the Drive-In", async () => {
      process.env.RUNESPACE_THEATRE_STAND_IN_ADS = "true";
      const who = await makeCharacter();
      await buy(who, T18);
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoHollow })
        .where(eq(rune.characters.id, who.characterId));
      expect((await authorize(who)).viewing).toMatchObject({
        status: "refused",
        reason: "not_at_theatre",
      });
      // The entitlement is still recorded...
      expect((await ledger(who.characterId)).pointers).toHaveLength(1);
      // ...and works again the moment they are back, with nothing re-bought.
      await db
        .update(rune.characters)
        .set({ currentLocationId: LOCATION_IDS.holoDriveIn })
        .where(eq(rune.characters.id, who.characterId));
      expect((await authorize(who, T19)).viewing).toMatchObject({
        status: "allowed",
        filmId: MINES,
      });
    });

    it("refuses a character already on the road, so a walk cannot carry a portable replay", async () => {
      process.env.RUNESPACE_THEATRE_STAND_IN_ADS = "true";
      const who = await makeCharacter();
      await buy(who, T18);
      const begun = await play.beginTravel(
        who.userId,
        who.characterId,
        LOCATION_IDS.holoHollow,
        at(T18),
      );
      expect(begun.travelError).toBeUndefined();
      expect((await authorize(who)).viewing).toMatchObject({
        status: "refused",
        reason: "in_transit",
      });
    });

    it("charges, grants and records nothing, however many times it is asked", async () => {
      process.env.RUNESPACE_THEATRE_STAND_IN_ADS = "true";
      const who = await makeCharacter();
      await buy(who, T18, COMBO_TIER);
      const before = await ledger(who.characterId);
      // Watch, Restart, Replay, in-viewer Replay: every start asks, in any number, in parallel.
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, index) => authorize(who, index % 2 ? T19 : T18)),
      );
      expect(results.every((result) => result.viewing.status === "allowed")).toBe(true);
      expect(await ledger(who.characterId)).toEqual(before);
    });

    it("refuses a refused start without writing anything either", async () => {
      const who = await makeCharacter({ locationId: LOCATION_IDS.holoHollow });
      const before = await ledger(who.characterId);
      expect((await authorize(who)).viewing).toMatchObject({ status: "refused" });
      expect(await ledger(who.characterId)).toEqual(before);
    });

    it("refuses another player's character", async () => {
      process.env.RUNESPACE_THEATRE_STAND_IN_ADS = "true";
      const owner = await makeCharacter();
      const stranger = await makeCharacter();
      await buy(owner, T18);
      await expect(
        commands.authorizeTheatreViewing(stranger.userId, owner.characterId, at(T18)),
      ).rejects.toThrow();
    });
  });
});
