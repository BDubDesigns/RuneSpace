import { randomUUID } from "node:crypto";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Character } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { LOCATION_IDS } from "@/game/config/foundations";
import { MAXIMUM_CHARACTER_CREDITS } from "@/game/domain/player-trade-settlement";
import type { TradeCommandResult, TradeStateView } from "@/game/schemas/player-trade";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const token = () => Math.random().toString(36).slice(2, 8);
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);
const MINUTE = 60_000;

const { items, carrying } = getEffectiveGameBalance();
const MYKEA = items.starterContainer.itemId; // 8 slots, 10 kg
const SCRAP_BOX = items.scrapBox.itemId; // 3 slots, 5 kg
const SALVAGE = items.salvageCutter.itemId; // 5 kg
const SHALE = items.ferriteShale.itemId; // stack of 10
const FERRITE = items.refinedFerrite.itemId; // stack of 5

type Player = { userId: string; character: Character };

/**
 * Issue #267 acceptance against real PostgreSQL: an accepted session's offers,
 * server-owned versions, Ready/Confirm consent, and the atomic settlement and
 * audit behind the final Confirm. Every rejection is checked for zero
 * trade-state change; every race uses `Promise.all` against the real row locks
 * and every clock is injected, never slept on. Each commit is checked to move
 * exactly the agreed assets once, with exactly one audit row, and every path
 * that does not commit is checked to move nothing and audit nothing.
 */
suite("issue #267 player trade offers, settlement, and audit (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let trades: typeof import("@/server/player-trades");
  let audit: typeof import("@/server/player-trade-audit");
  let realtime: typeof import("@/server/realtime");
  let inventory: typeof import("@/server/inventory");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    trades = await import("@/server/player-trades");
    audit = await import("@/server/player-trade-audit");
    realtime = await import("@/server/realtime");
    inventory = await import("@/server/inventory");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  // --- fixtures ---------------------------------------------------------

  /** Equip the starter MYKEA (8 slots) the way Play provisioning would. */
  async function outfit(character: Character) {
    const [pack] = await db
      .insert(rune.itemInstances)
      .values({ characterId: character.id, itemId: MYKEA })
      .returning();
    await db.insert(rune.equippedItems).values({
      characterId: character.id,
      assignmentKind: "container",
      suitSlotId: carrying.containerSuitSlotIds[0],
      itemInstanceId: pack!.id,
    });
  }

  /** A fresh player whose character wears a MYKEA and an equipped Salvage Cutter. */
  async function player(): Promise<Player> {
    const userId = await createTestUser(db, authSchema, `settle-${token()}`);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Stl${token()}`,
    );
    await outfit(character);
    return { userId, character };
  }

  async function altOf(owner: Player): Promise<Player> {
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      owner.userId,
      `Alt${token()}`,
    );
    await outfit(character);
    return { userId: owner.userId, character };
  }

  async function setCredits(who: Player, credits: number) {
    await db
      .update(rune.characters)
      .set({ credits })
      .where(eq(rune.characters.id, who.character.id));
  }

  async function addStack(who: Player, itemId: string, quantity: number): Promise<string> {
    const [row] = await db
      .insert(rune.inventoryStacks)
      .values({ characterId: who.character.id, itemId, quantity })
      .returning({ id: rune.inventoryStacks.id });
    return row!.id;
  }

  async function addUnique(who: Player, itemId: string, currentCharge?: number): Promise<string> {
    const [row] = await db
      .insert(rune.itemInstances)
      .values({ characterId: who.character.id, itemId, currentCharge: currentCharge ?? null })
      .returning({ id: rune.itemInstances.id });
    return row!.id;
  }

  async function storeInCargo(who: Player, itemInstanceId: string) {
    await db
      .insert(rune.cargoHoldItemInstances)
      .values({ characterId: who.character.id, itemInstanceId });
  }

  /** The fixture's equipped Salvage Cutter. */
  async function equippedCutter(who: Player): Promise<string> {
    const [row] = await db
      .select({ id: rune.equippedItems.itemInstanceId })
      .from(rune.equippedItems)
      .where(
        and(
          eq(rune.equippedItems.characterId, who.character.id),
          eq(rune.equippedItems.assignmentKind, "gear"),
        ),
      );
    return row!.id;
  }

  /** Take the fixture's Cutter off, leaving it carried. */
  async function unequipCutter(who: Player): Promise<string> {
    const id = await equippedCutter(who);
    await db
      .delete(rune.equippedItems)
      .where(
        and(
          eq(rune.equippedItems.characterId, who.character.id),
          eq(rune.equippedItems.itemInstanceId, id),
        ),
      );
    return id;
  }

  /** Seven full Refined Ferrite stacks and a full Ferrite Shale stack: 8 of 8 slots. */
  async function fillInventory(who: Player) {
    for (let index = 0; index < 7; index += 1) await addStack(who, FERRITE, 5);
    return addStack(who, SHALE, 10);
  }

  // --- command shorthands -------------------------------------------------

  function ok(result: TradeCommandResult): TradeStateView {
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.reason}`);
    return result.state;
  }

  function refusal(result: TradeCommandResult) {
    if (result.status !== "refused") throw new Error("expected a refusal");
    return result.reason;
  }

  async function openSession(requester: Player, recipient: Player, now: Date) {
    const sent = ok(
      await trades.createTradeRequest(
        requester.userId,
        requester.character.id,
        { characterId: recipient.character.id },
        now,
      ),
    );
    const state = ok(
      await trades.acceptTradeRequest(
        recipient.userId,
        recipient.character.id,
        sent.outgoing!.id,
        now,
      ),
    );
    return state.session!.id;
  }

  async function sessionRow(id: string) {
    const [row] = await db
      .select()
      .from(rune.playerTradeSessions)
      .where(eq(rune.playerTradeSessions.id, id));
    return row!;
  }

  async function version(id: string) {
    return (await sessionRow(id)).offerVersion;
  }

  /** Commands that read the current version unless a test names a stale one. */
  function trader(who: Player, sessionId: string, now: Date) {
    const v = async (given?: number) => given ?? (await version(sessionId));
    const id = who.character.id;
    return {
      credits: async (credits: number, at?: number) =>
        trades.setTradeOfferCredits(who.userId, id, sessionId, await v(at), credits, now),
      addStack: async (itemId: string, quantity: number, at?: number) =>
        trades.addTradeOfferStack(who.userId, id, sessionId, await v(at), itemId, quantity, now),
      removeStack: async (itemId: string, quantity: number, at?: number) =>
        trades.removeTradeOfferStack(who.userId, id, sessionId, await v(at), itemId, quantity, now),
      addItem: async (itemInstanceId: string, at?: number) =>
        trades.addTradeOfferItem(who.userId, id, sessionId, await v(at), itemInstanceId, now),
      removeItem: async (itemInstanceId: string, at?: number) =>
        trades.removeTradeOfferItem(who.userId, id, sessionId, await v(at), itemInstanceId, now),
      ready: async (at?: number) =>
        trades.readyTradeOffer(who.userId, id, sessionId, await v(at), now),
      change: async (at?: number) =>
        trades.changeTradeOffer(who.userId, id, sessionId, await v(at), now),
      confirm: async (at?: number) =>
        trades.confirmTrade(who.userId, id, sessionId, await v(at), now),
      cancel: () => trades.cancelTradeSession(who.userId, id, sessionId, now),
      state: () => trades.getTradeState(who.userId, id, now),
    };
  }

  // --- authoritative reads --------------------------------------------------

  /** Everything a trade could move, for one character, in a stable order. */
  async function holdings(who: Player) {
    const [character] = await db
      .select({ credits: rune.characters.credits })
      .from(rune.characters)
      .where(eq(rune.characters.id, who.character.id));
    const stacks = await db
      .select({ itemId: rune.inventoryStacks.itemId, quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(eq(rune.inventoryStacks.characterId, who.character.id))
      .orderBy(asc(rune.inventoryStacks.itemId), asc(rune.inventoryStacks.quantity));
    const instances = await db
      .select({
        id: rune.itemInstances.id,
        itemId: rune.itemInstances.itemId,
        currentCharge: rune.itemInstances.currentCharge,
      })
      .from(rune.itemInstances)
      .where(eq(rune.itemInstances.characterId, who.character.id))
      .orderBy(asc(rune.itemInstances.id));
    return { credits: character!.credits, stacks, instances };
  }

  async function world([first, second]: [Player, Player]) {
    return [await holdings(first), await holdings(second)] as const;
  }

  /** The session row's trade state, without the activity clock. */
  async function tradeState(sessionId: string) {
    const row = await sessionRow(sessionId);
    const stacks = await db
      .select()
      .from(rune.playerTradeOfferStacks)
      .where(eq(rune.playerTradeOfferStacks.sessionId, sessionId))
      .orderBy(
        asc(rune.playerTradeOfferStacks.characterId),
        asc(rune.playerTradeOfferStacks.itemId),
      );
    const offeredItems = await db
      .select()
      .from(rune.playerTradeOfferItems)
      .where(eq(rune.playerTradeOfferItems.sessionId, sessionId))
      .orderBy(asc(rune.playerTradeOfferItems.itemInstanceId));
    return { row, stacks, offeredItems };
  }

  async function auditsFor(sessionId: string) {
    return db
      .select()
      .from(rune.playerTradeAudits)
      .where(eq(rune.playerTradeAudits.tradeId, sessionId));
  }

  async function auditsInvolving(players: Player[]) {
    const rows = await db
      .select()
      .from(rune.playerTradeAudits)
      .where(
        or(
          ...players.flatMap((p) => [
            eq(rune.playerTradeAudits.requesterCharacterId, p.character.id),
            eq(rune.playerTradeAudits.recipientCharacterId, p.character.id),
          ]),
        ),
      );
    return rows;
  }

  /** Every realtime prompt these players' characters receive while `run` executes. */
  async function watchPrompts(players: Player[], run: () => Promise<unknown>) {
    const received: { characterId: string; type: string; data: unknown }[] = [];
    const unsubscribes = players.map(({ character }) =>
      realtime.getRealtimeFanout().subscribe({
        scope: { playerAccountId: character.playerAccountId, characterId: character.id },
        deliver: (envelope) =>
          received.push({ characterId: character.id, type: envelope.type, data: envelope.data }),
        close: () => {},
      }),
    );
    try {
      await run();
    } finally {
      for (const unsubscribe of unsubscribes) unsubscribe();
    }
    return received;
  }

  // --- offers, versions, and consent ---------------------------------------

  it("owns the offer version and clears both participants' consent on every edit", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    await setCredits(a, 20);
    await addStack(a, SHALE, 6);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];

    const opened = (await ta.state()).session!;
    expect(opened.offerVersion).toBe(1);
    expect(opened.phase).toBe("compose");
    expect(opened.yours).toEqual({
      credits: 0,
      stacks: [],
      items: [],
      ready: false,
      confirmed: false,
    });

    ok(await ta.credits(7));
    let row = await sessionRow(sessionId);
    expect(row.offerVersion).toBe(2);
    expect(row.requesterCredits).toBe(7);
    ok(await tb.ready());
    expect((await sessionRow(sessionId)).recipientReady).toBe(true);

    // Any edit clears the counterpart's Ready.
    ok(await ta.addStack(SHALE, 4));
    expect((await sessionRow(sessionId)).recipientReady).toBe(false);
    ok(await ta.ready());
    const bState = ok(await tb.ready());
    expect(bState.session!.phase).toBe("review");
    expect(bState.session!.theirs).toMatchObject({
      credits: 7,
      stacks: [{ itemId: SHALE, quantity: 4 }],
      ready: true,
    });
    expect(bState.session!.yours.ready).toBe(true);

    // Frozen: editing needs Change Offer first, and the refusal changes nothing.
    const frozen = await tradeState(sessionId);
    expect(refusal(await ta.credits(1))).toBe("offer_frozen");
    expect(refusal(await tb.addStack(SHALE, 1))).toBe("offer_frozen");
    expect(await tradeState(sessionId)).toEqual(frozen);

    ok(await tb.change());
    row = await sessionRow(sessionId);
    expect(row.offerVersion).toBe(frozen.row.offerVersion + 1);
    expect([row.requesterReady, row.recipientReady]).toEqual([false, false]);

    // Change Offer with no consent to clear changes nothing.
    ok(await tb.change());
    expect(await version(sessionId)).toBe(row.offerVersion);

    // Ready is idempotent and never advances the version.
    ok(await ta.ready());
    ok(await ta.ready());
    expect(await version(sessionId)).toBe(row.offerVersion);

    // Remove what was added: back to an empty stack offer.
    ok(await ta.removeStack(SHALE, 4));
    expect((await tradeState(sessionId)).stacks).toEqual([]);
    expect(await auditsFor(sessionId)).toEqual([]);
  });

  it("refuses every malformed, foreign, or stale mutation with zero trade-state change", async () => {
    const now = new Date();
    const [a, b, outsider] = [await player(), await player(), await player()];
    await setCredits(a, 10);
    await addStack(a, SHALE, 3);
    const stored = await addUnique(a, SCRAP_BOX);
    await storeInCargo(a, stored);
    const bItem = await addUnique(b, SCRAP_BOX);
    await addStack(b, FERRITE, 2);
    const aCutter = await equippedCutter(a);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    ok(await ta.credits(4));
    ok(await tb.addStack(FERRITE, 1));
    ok(await tb.ready());

    const before = await tradeState(sessionId);
    const assets = await world([a, b]);
    const current = before.row.offerVersion;
    const expectUnchanged = async (result: Promise<TradeCommandResult>, reason: string) => {
      expect(refusal(await result)).toBe(reason);
      expect(await tradeState(sessionId)).toEqual(before);
    };

    // Credits: negative, fractional, non-finite, malformed, over balance.
    for (const credits of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 11]) {
      await expectUnchanged(ta.credits(credits), "invalid_offer");
    }
    await expectUnchanged(ta.credits("5" as unknown as number), "invalid_offer");
    // Stacks: zero, negative, fractional, beyond what is carried, not a stack.
    for (const quantity of [0, -2, 1.5, 4]) {
      await expectUnchanged(ta.addStack(SHALE, quantity), "invalid_offer");
    }
    await expectUnchanged(ta.addStack(SALVAGE, 1), "invalid_offer");
    await expectUnchanged(ta.addStack("not_an_item", 1), "invalid_offer");
    // Uniques: the counterpart's, equipped, in the Cargo Hold, unknown.
    for (const id of [bItem, aCutter, stored, randomUUID()]) {
      await expectUnchanged(ta.addItem(id), "invalid_offer");
    }
    // The counterpart's side cannot be reached: A's commands touch only A's offer.
    await expectUnchanged(ta.removeStack(FERRITE, 1), "invalid_offer");
    await expectUnchanged(ta.removeItem(bItem), "invalid_offer");
    // Stale and replayed versions, valid or not.
    await expectUnchanged(ta.credits(2, current - 1), "stale_offer");
    await expectUnchanged(ta.ready(current - 1), "stale_offer");
    await expectUnchanged(ta.addStack(SHALE, 1, current + 1), "stale_offer");
    // A nonparticipant, and a guessed id, read exactly like a missing trade.
    await expectUnchanged(
      trades.setTradeOfferCredits(
        outsider.userId,
        outsider.character.id,
        sessionId,
        current,
        1,
        now,
      ),
      "unavailable",
    );
    await expectUnchanged(
      trades.confirmTrade(outsider.userId, outsider.character.id, sessionId, current, now),
      "unavailable",
    );
    await expectUnchanged(
      trades.setTradeOfferCredits(a.userId, a.character.id, randomUUID(), current, 1, now),
      "unavailable",
    );
    // A participant's character under the wrong account is not theirs at all.
    await expect(
      trades.setTradeOfferCredits(outsider.userId, a.character.id, sessionId, current, 1, now),
    ).rejects.toThrow("Character not found");
    expect(await tradeState(sessionId)).toEqual(before);

    expect(await world([a, b])).toEqual(assets);
    expect(await auditsFor(sessionId)).toEqual([]);
  });

  it("refuses to Ready or commit a trade where neither side offers anything", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    const empty = await tradeState(sessionId);
    expect(refusal(await ta.ready())).toBe("empty_trade");
    expect(refusal(await tb.ready())).toBe("empty_trade");
    expect(await tradeState(sessionId)).toEqual(empty);

    // Settlement re-checks it too, should a frozen review ever hold two empty
    // offers (forced here directly; no command can produce it).
    await db
      .update(rune.playerTradeSessions)
      .set({ requesterReady: true, recipientReady: true, requesterConfirmed: true })
      .where(eq(rune.playerTradeSessions.id, sessionId));
    const assets = await world([a, b]);
    expect(refusal(await tb.confirm())).toBe("empty_trade");
    const row = await sessionRow(sessionId);
    expect(row.status).toBe("active");
    expect(row.offerVersion).toBe(empty.row.offerVersion + 1);
    expect([row.requesterReady, row.recipientReady, row.requesterConfirmed]).toEqual([
      false,
      false,
      false,
    ]);
    expect(await world([a, b])).toEqual(assets);
    expect(await auditsFor(sessionId)).toEqual([]);

    // A one-sided gift is still a trade.
    ok(await tb.credits(1));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());
    const done = await tb.confirm();
    expect(done.status === "ok" && done.completed?.tradeId).toBe(sessionId);
  });

  it("treats setting Credits to the amount already offered as a no-op", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    await setCredits(a, 10);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    ok(await ta.credits(4));
    ok(await tb.ready());
    let before = await tradeState(sessionId);
    const watched = await watchPrompts([a, b], () => ta.credits(4));
    expect(await tradeState(sessionId)).toEqual(before);
    expect(watched).toEqual([]);

    // In the frozen review, and after a Confirm, it still changes nothing.
    ok(await ta.ready());
    ok(await tb.confirm());
    before = await tradeState(sessionId);
    ok(await ta.credits(4));
    ok(await tb.credits(0));
    expect(await tradeState(sessionId)).toEqual(before);
    // A different amount is still refused while frozen.
    expect(refusal(await ta.credits(5))).toBe("offer_frozen");
  });

  it("refuses a settlement that would overflow a stored Credit balance", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    await setCredits(a, 10);
    await setCredits(b, MAXIMUM_CHARACTER_CREDITS - 1);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    ok(await ta.credits(2));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());
    const assets = await world([a, b]);
    const refused = await tb.confirm();
    expect(refusal(refused)).toBe("credit_limit");
    expect(refused.status === "refused" && refused.error).toContain("leave you");
    expect(await world([a, b])).toEqual(assets);
    expect((await sessionRow(sessionId)).status).toBe("active");
    expect(await auditsFor(sessionId)).toEqual([]);

    // Exactly to the limit is fine.
    ok(await ta.credits(1));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());
    const done = await tb.confirm();
    expect(done.status === "ok" && done.completed).toBeTruthy();
    expect((await holdings(b)).credits).toBe(MAXIMUM_CHARACTER_CREDITS);
  });

  it("never lets a stale Ready or Confirm consent to a newer proposal", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    await setCredits(a, 10);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];

    const seen = await version(sessionId);
    // Another tab edits before this tab's Ready lands.
    ok(await ta.credits(3));
    expect(refusal(await ta.ready(seen))).toBe("stale_offer");
    expect((await sessionRow(sessionId)).requesterReady).toBe(false);

    ok(await ta.ready());
    ok(await tb.ready());
    const reviewed = await version(sessionId);
    ok(await tb.confirm(reviewed));
    // Change Offer spends every earlier consent, B's Confirm included.
    ok(await ta.change());
    const row = await sessionRow(sessionId);
    expect([row.requesterReady, row.recipientReady, row.recipientConfirmed]).toEqual([
      false,
      false,
      false,
    ]);
    const assets = await world([a, b]);
    expect(refusal(await ta.confirm(reviewed))).toBe("stale_offer");
    expect(refusal(await tb.confirm(reviewed))).toBe("stale_offer");
    expect(refusal(await ta.confirm())).toBe("not_ready");
    expect(await world([a, b])).toEqual(assets);
    expect(await auditsFor(sessionId)).toEqual([]);
  });

  // --- settlement ---------------------------------------------------------

  it("moves exactly the agreed Credits, stacks, and unique instances once, with one audit row", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    await setCredits(a, 30);
    await setCredits(b, 4);
    await addStack(a, SHALE, 7);
    const cutter = await addUnique(a, SALVAGE, 6);
    await addStack(b, FERRITE, 3);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];

    ok(await ta.credits(12));
    ok(await ta.addStack(SHALE, 5));
    ok(await ta.addItem(cutter));
    ok(await tb.credits(2));
    ok(await tb.addStack(FERRITE, 3));
    const review = ok(await ta.ready());
    expect(review.session!.yours.items).toEqual([
      { itemInstanceId: cutter, itemId: SALVAGE, currentCharge: 6 },
    ]);
    ok(await tb.ready());

    // The first Confirm moves nothing.
    const before = await world([a, b]);
    const first = await ta.confirm();
    expect(first.status === "ok" && first.completed).toBeFalsy();
    expect(await world([a, b])).toEqual(before);
    expect(await auditsFor(sessionId)).toEqual([]);

    const second = await tb.confirm();
    if (second.status !== "ok" || !second.completed) throw new Error("expected completion");
    expect(second.completed.tradeId).toBe(sessionId);
    expect(second.state.session).toBeNull();

    const [afterA, afterB] = await world([a, b]);
    expect(afterA.credits).toBe(30 - 12 + 2);
    expect(afterB.credits).toBe(4 - 2 + 12);
    expect(afterA.stacks).toEqual(
      [
        { itemId: SHALE, quantity: 2 },
        { itemId: FERRITE, quantity: 3 },
      ].sort((x, y) => x.itemId.localeCompare(y.itemId)),
    );
    expect(afterB.stacks).toEqual([{ itemId: SHALE, quantity: 5 }]);
    // The same instance, with its charge, now belongs to B.
    expect(afterA.instances.some((instance) => instance.id === cutter)).toBe(false);
    expect(afterB.instances).toContainEqual({ id: cutter, itemId: SALVAGE, currentCharge: 6 });
    // Nothing else appeared or disappeared.
    expect(afterA.instances.length + afterB.instances.length).toBe(
      before[0]!.instances.length + before[1]!.instances.length,
    );

    const session = await sessionRow(sessionId);
    expect(session.status).toBe("completed");
    expect(
      await db
        .select()
        .from(rune.playerTradeClaims)
        .where(eq(rune.playerTradeClaims.sessionId, sessionId)),
    ).toEqual([]);

    const [row] = await auditsFor(sessionId);
    expect(row).toMatchObject({
      tradeId: sessionId,
      locationId: LOCATION_IDS.crashSite,
      requesterPlayerAccountId: a.character.playerAccountId,
      requesterCharacterId: a.character.id,
      recipientPlayerAccountId: b.character.playerAccountId,
      recipientCharacterId: b.character.id,
      requesterCredits: 12,
      recipientCredits: 2,
      requesterStacks: [{ itemId: SHALE, quantity: 5 }],
      recipientStacks: [{ itemId: FERRITE, quantity: 3 }],
      requesterItems: [{ itemInstanceId: cutter, itemId: SALVAGE }],
      recipientItems: [],
    });
    expect(row!.committedAt.getTime()).toBe(now.getTime());

    // Retries resolve to the completed trade and change nothing.
    const settled = await world([a, b]);
    for (const retry of [await tb.confirm(), await ta.confirm(), await tb.confirm(1)]) {
      expect(retry.status === "ok" && retry.completed?.tradeId).toBe(sessionId);
    }
    // Late Cancel is inert; late edits and Ready read as an ended trade.
    ok(await ta.cancel());
    expect(refusal(await ta.credits(1, session.offerVersion))).toBe("unavailable");
    expect(refusal(await tb.ready(session.offerVersion))).toBe("unavailable");
    expect((await sessionRow(sessionId)).status).toBe("completed");
    expect(await world([a, b])).toEqual(settled);
    expect(await auditsFor(sessionId)).toHaveLength(1);
  });

  it("settles a one-sided gift between two characters of the same account", async () => {
    const now = new Date();
    const main = await player();
    const alt = await altOf(main);
    await setCredits(main, 9);
    await addStack(main, FERRITE, 4);
    const sessionId = await openSession(main, alt, now);
    const [tm, tl] = [trader(main, sessionId, now), trader(alt, sessionId, now)];
    ok(await tm.credits(9));
    ok(await tm.addStack(FERRITE, 4));
    ok(await tm.ready());
    ok(await tl.ready());
    ok(await tl.confirm());
    const done = await tm.confirm();
    expect(done.status === "ok" && done.completed?.tradeId).toBe(sessionId);

    const [mainAfter, altAfter] = await world([main, alt]);
    expect(mainAfter.credits).toBe(0);
    expect(mainAfter.stacks).toEqual([]);
    expect(altAfter.credits).toBe(10 + 9);
    expect(altAfter.stacks).toEqual([{ itemId: FERRITE, quantity: 4 }]);
    const [row] = await auditsFor(sessionId);
    expect(row!.requesterPlayerAccountId).toBe(row!.recipientPlayerAccountId);
    expect(row!.recipientCredits).toBe(0);
  });

  it("commits exactly once under near-simultaneous and duplicated final Confirms", async () => {
    for (let round = 0; round < 3; round += 1) {
      const now = new Date();
      const [a, b] = [await player(), await player()];
      await setCredits(a, 10);
      await addStack(b, SHALE, 5);
      const sessionId = await openSession(a, b, now);
      const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
      ok(await ta.credits(6));
      ok(await tb.addStack(SHALE, 5));
      ok(await ta.ready());
      ok(await tb.ready());
      const v = await version(sessionId);

      // Rounds 0 and 1 race both participants' final Confirms; round 2 has A
      // confirm first and races B's double-click against itself.
      if (round === 2) ok(await ta.confirm(v));
      const results =
        round === 2
          ? await Promise.all([tb.confirm(v), tb.confirm(v)])
          : await Promise.all([ta.confirm(v), tb.confirm(v)]);
      expect(results.every((result) => result.status === "ok")).toBe(true);
      expect(results.some((result) => result.status === "ok" && result.completed)).toBe(true);

      const [afterA, afterB] = await world([a, b]);
      expect(afterA.credits).toBe(4);
      expect(afterA.stacks).toEqual([{ itemId: SHALE, quantity: 5 }]);
      expect(afterB.credits).toBe(16);
      expect(afterB.stacks).toEqual([]);
      expect(await auditsFor(sessionId)).toHaveLength(1);
      for (const userId of createdUsers.splice(0))
        await cleanupTestUser(db, authSchema, rune, userId);
    }
  });

  // Four independent attempts, one per test (issue #279): each round builds
  // its own two players and session, so bundling all four into one test only
  // shared one 5-second budget between four rounds of fixture setup and
  // teardown. Even attempts race the confirmer against the other trader's
  // Cancel, odd attempts against its own.
  it.each([0, 1, 2, 3])(
    "resolves final Confirm against Cancel to exactly one legal world (attempt %i)",
    async (round) => {
      const now = new Date();
      const [a, b] = [await player(), await player()];
      await setCredits(a, 10);
      const cutter = await addUnique(b, SALVAGE, 3);
      const sessionId = await openSession(a, b, now);
      const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
      ok(await ta.credits(5));
      ok(await tb.addItem(cutter));
      ok(await ta.ready());
      ok(await tb.ready());
      ok(await ta.confirm());
      const before = await world([a, b]);

      const [confirm] = await Promise.all(
        round % 2 === 0 ? [tb.confirm(), ta.cancel()] : [tb.confirm(), tb.cancel()],
      );
      const session = await sessionRow(sessionId);
      const audits = await auditsFor(sessionId);
      // Either order is legal; no third world is.
      if (session.status === "completed") {
        expect(confirm.status === "ok" && confirm.completed?.tradeId).toBe(sessionId);
        expect(audits).toHaveLength(1);
        const [afterA, afterB] = await world([a, b]);
        expect(afterA.credits).toBe(5);
        expect(afterA.instances).toContainEqual({ id: cutter, itemId: SALVAGE, currentCharge: 3 });
        expect(afterB.credits).toBe(15);
      } else {
        expect(session.status).toBe("canceled");
        expect(refusal(confirm)).toBe("unavailable");
        expect(audits).toEqual([]);
        expect(await world([a, b])).toEqual(before);
      }
    },
  );

  it("rolls back every transfer when the audit write fails", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    await setCredits(a, 10);
    await addStack(a, SHALE, 4);
    const cutter = await addUnique(b, SALVAGE, 2);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    ok(await ta.credits(8));
    ok(await ta.addStack(SHALE, 4));
    ok(await tb.addItem(cutter));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());
    const assets = await world([a, b]);
    const state = await tradeState(sessionId);

    // A deterministic failure at the audit insert, for this trade only.
    const fn = `fail_trade_audit_${token()}`;
    await db.execute(
      sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
        begin
          if new.trade_id = '${sessionId}' then raise exception 'forced audit failure'; end if;
          return new;
        end $$`),
    );
    await db.execute(
      sql.raw(
        `create trigger ${fn} before insert on player_trade_audits for each row execute function ${fn}()`,
      ),
    );
    try {
      await expect(tb.confirm()).rejects.toThrow();
    } finally {
      await db.execute(sql.raw(`drop trigger ${fn} on player_trade_audits`));
      await db.execute(sql.raw(`drop function ${fn}()`));
    }

    // Nothing moved, the session is exactly as it was, and no audit exists.
    expect(await world([a, b])).toEqual(assets);
    expect(await tradeState(sessionId)).toEqual(state);
    expect(await auditsFor(sessionId)).toEqual([]);

    // The same proposal still settles once the audit can be written.
    const done = await tb.confirm();
    expect(done.status === "ok" && done.completed?.tradeId).toBe(sessionId);
    expect(await auditsFor(sessionId)).toHaveLength(1);
  });

  // --- capacity and protection --------------------------------------------

  it("lets a full Inventory complete a one-for-one swap, merging into partial stacks", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    const box = await addUnique(a, SCRAP_BOX);
    await addStack(a, SHALE, 3);
    await fillInventory(b);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    // B gives one full Ferrite stack and takes a unique: still 8 of 8.
    ok(await ta.addItem(box));
    ok(await tb.addStack(FERRITE, 5));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());
    const done = await tb.confirm();
    expect(done.status === "ok" && done.completed).toBeTruthy();
    const [afterA, afterB] = await world([a, b]);
    expect(afterB.instances.map((instance) => instance.id)).toContain(box);
    expect(afterB.stacks).toHaveLength(7);
    expect(afterA.stacks).toEqual(
      [
        { itemId: SHALE, quantity: 3 },
        { itemId: FERRITE, quantity: 5 },
      ].sort((x, y) => x.itemId.localeCompare(y.itemId)),
    );
  });

  it("merges incoming stacks by their limits and refuses true slot overflow, correctably", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    await addStack(a, SHALE, 10);
    const box = await addUnique(a, SCRAP_BOX);
    for (let index = 0; index < 7; index += 1) await addStack(b, FERRITE, 5);
    await addStack(b, SHALE, 7);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];

    // A full B receiving a Scrap Box: it would add 3 slots once equipped, but
    // a container received in this trade adds no capacity to this trade.
    ok(await ta.addItem(box));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await tb.confirm());
    const assets = await world([a, b]);
    const reviewed = await version(sessionId);
    const refused = await ta.confirm();
    expect(refusal(refused)).toBe("inventory_full");
    expect(refused.status === "refused" && refused.error).toContain(b.character.displayName);
    expect(await world([a, b])).toEqual(assets);
    // Back to a correctable compose state on a new version; nothing audited.
    let row = await sessionRow(sessionId);
    expect(row.status).toBe("active");
    expect(row.offerVersion).toBe(reviewed + 1);
    expect([row.requesterReady, row.recipientReady, row.recipientConfirmed]).toEqual([
      false,
      false,
      false,
    ]);
    expect(await auditsFor(sessionId)).toEqual([]);

    // Four Shale need a ninth slot: still too much.
    ok(await ta.removeItem(box));
    ok(await ta.addStack(SHALE, 4));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await tb.confirm());
    expect(refusal(await ta.confirm())).toBe("inventory_full");

    // Three merge into B's partial stack of 7.
    ok(await ta.removeStack(SHALE, 1));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await tb.confirm());
    const done = await ta.confirm();
    expect(done.status === "ok" && done.completed).toBeTruthy();
    const afterB = await holdings(b);
    expect(afterB.stacks.filter((stack) => stack.itemId === SHALE)).toEqual([
      { itemId: SHALE, quantity: 10 },
    ]);
    row = await sessionRow(sessionId);
    expect(row.status).toBe("completed");
  });

  it("refuses true mass overflow with nothing moved", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    // 40 kg of packs in 4 slots; B already wears 15 kg of its 50 kg.
    const packs = [];
    for (let index = 0; index < 4; index += 1) packs.push(await addUnique(a, MYKEA));
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    for (const pack of packs) ok(await ta.addItem(pack));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());
    const assets = await world([a, b]);
    expect(refusal(await tb.confirm())).toBe("too_heavy");
    expect(await world([a, b])).toEqual(assets);
    expect(await auditsFor(sessionId)).toEqual([]);
  });

  it("guards the last usable Cutter and allows a Cutter-for-Cutter swap with charge intact", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    const aCutter = await equippedCutter(a);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    // Equipped: not offerable at all.
    expect(refusal(await ta.addItem(aCutter))).toBe("invalid_offer");

    // Unequipped and carried, it is A's only Cutter.
    await unequipCutter(a);
    await db
      .update(rune.itemInstances)
      .set({ currentCharge: 4 })
      .where(eq(rune.itemInstances.id, aCutter));
    ok(await ta.addItem(aCutter));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await tb.confirm());
    const assets = await world([a, b]);
    const refused = await ta.confirm();
    expect(refusal(refused)).toBe("last_cutter");
    expect(refused.status === "refused" && refused.error).toContain("you");
    expect(await world([a, b])).toEqual(assets);

    // B offers a Cutter back: each side still ends with one usable Cutter.
    const bSpare = await addUnique(b, SALVAGE, 9);
    ok(await tb.addItem(bSpare));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());
    const done = await tb.confirm();
    expect(done.status === "ok" && done.completed).toBeTruthy();
    const [afterA, afterB] = await world([a, b]);
    expect(afterA.instances).toContainEqual({ id: bSpare, itemId: SALVAGE, currentCharge: 9 });
    expect(afterB.instances).toContainEqual({ id: aCutter, itemId: SALVAGE, currentCharge: 4 });
    const [row] = await auditsFor(sessionId);
    expect(row!.requesterItems).toEqual([{ itemInstanceId: aCutter, itemId: SALVAGE }]);
    expect(row!.recipientItems).toEqual([{ itemInstanceId: bSpare, itemId: SALVAGE }]);
  });

  it("counts a Cutter in the Cargo Hold toward last-Cutter safety", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    const carried = await unequipCutter(a);
    await storeInCargo(a, await addUnique(a, SALVAGE));
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    ok(await ta.addItem(carried));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());
    const done = await tb.confirm();
    expect(done.status === "ok" && done.completed).toBeTruthy();
  });

  // --- revalidation at commit ---------------------------------------------

  it("re-proves ownership and location at commit and fails closed", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    const shale = await addStack(a, SHALE, 5);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    ok(await ta.addStack(SHALE, 5));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await tb.confirm());

    // Authoritative state changed underneath the offer (as an operator might).
    await db
      .update(rune.inventoryStacks)
      .set({ quantity: 3 })
      .where(eq(rune.inventoryStacks.id, shale));
    let assets = await world([a, b]);
    const refused = await ta.confirm();
    expect(refusal(refused)).toBe("offer_unavailable");
    expect(await world([a, b])).toEqual(assets);

    // A character that is somehow elsewhere fails closed too.
    ok(await ta.removeStack(SHALE, 2));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await tb.confirm());
    await db
      .update(rune.characters)
      .set({ currentLocationId: LOCATION_IDS.abandonedProcessingYard })
      .where(eq(rune.characters.id, b.character.id));
    assets = await world([a, b]);
    expect(refusal(await ta.confirm())).toBe("ineligible");
    expect(await world([a, b])).toEqual(assets);
    expect((await sessionRow(sessionId)).status).toBe("active");
    expect(await auditsFor(sessionId)).toEqual([]);
  });

  // --- durability and inactivity -----------------------------------------

  it("keeps offers, version, and consent across reloads and expires idle trades moving nothing", async () => {
    const t0 = new Date();
    const [a, b] = [await player(), await player()];
    await setCredits(a, 10);
    const sessionId = await openSession(a, b, t0);

    // Activity at +4 minutes refreshes the deadline past t0 + 5 minutes.
    const t4 = plus(t0, 4 * MINUTE);
    ok(await trader(a, sessionId, t4).credits(6));
    const t8 = plus(t0, 8 * MINUTE);
    ok(await trader(b, sessionId, t8).ready());

    // A reload, from either side, sees the same durable trade.
    const fromA = (await trader(a, sessionId, t8).state()).session!;
    const fromB = (await trader(b, sessionId, t8).state()).session!;
    expect(fromA.id).toBe(sessionId);
    expect(fromA.offerVersion).toBe(fromB.offerVersion);
    expect(fromA.yours).toEqual(fromB.theirs);
    expect(fromA.theirs).toEqual(fromB.yours);
    expect(fromA.yours.credits).toBe(6);
    expect(fromB.yours.ready).toBe(true);
    expect(fromA.expiresAt).toBe(plus(t8, 5 * MINUTE).toISOString());

    // Five idle minutes later the trade is over and nothing moved.
    const assets = await world([a, b]);
    const idle = plus(t8, 5 * MINUTE);
    expect(refusal(await trader(a, sessionId, idle).ready())).toBe("unavailable");
    const row = await sessionRow(sessionId);
    expect(row.status).toBe("expired");
    expect(row.endedAt!.getTime()).toBe(idle.getTime());
    expect(
      await db
        .select()
        .from(rune.playerTradeClaims)
        .where(eq(rune.playerTradeClaims.sessionId, sessionId)),
    ).toEqual([]);
    expect(refusal(await trader(b, sessionId, idle).confirm())).toBe("unavailable");
    expect(await world([a, b])).toEqual(assets);
    expect(await auditsFor(sessionId)).toEqual([]);
  });

  it("makes an idle release final before the released character acts", async () => {
    const t0 = new Date();
    const [a, b] = [await player(), await player()];
    const shale = await addStack(a, SHALE, 5);
    const sessionId = await openSession(a, b, t0);
    const before = plus(t0, 4 * MINUTE);
    const [ta, tb] = [trader(a, sessionId, before), trader(b, sessionId, before)];
    ok(await ta.addStack(SHALE, 5));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());

    // Past the deadline, A is released and drops the Shale it had offered.
    const released = plus(before, 5 * MINUTE);
    const dropped = await inventory.discardInventoryStack(
      a.userId,
      a.character.id,
      { stackId: shale, mode: "stack", expectedQuantity: 5 },
      released,
    );
    expect(dropped.discard.status).toBe("discarded");
    const row = await sessionRow(sessionId);
    expect(row.status).toBe("expired");
    expect(row.endedAt!.getTime()).toBe(plus(before, 5 * MINUTE).getTime());

    // B's final Confirm, its clock read before the deadline, cannot revive it.
    const assets = await world([a, b]);
    expect(refusal(await tb.confirm())).toBe("unavailable");
    expect(await world([a, b])).toEqual(assets);
    expect(await auditsFor(sessionId)).toEqual([]);
  });

  it("writes no audit for canceled, expired, or refused trades", async () => {
    const now = new Date();
    const [a, b] = [await player(), await player()];
    await setCredits(a, 10);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
    ok(await ta.credits(10));
    ok(await ta.ready());
    ok(await tb.ready());
    ok(await ta.confirm());
    // Cancel is available at any time before commit, even after a Confirm.
    ok(await tb.cancel());
    expect((await sessionRow(sessionId)).status).toBe("canceled");
    expect(refusal(await tb.confirm())).toBe("unavailable");
    expect((await holdings(a)).credits).toBe(10);
    expect(await auditsInvolving([a, b])).toEqual([]);
  });

  // --- audit queries --------------------------------------------------------

  it("finds committed trades by trade id and by either account or character", async () => {
    const now = new Date();
    const [a, b, c] = [await player(), await player(), await player()];
    await setCredits(a, 10);
    const trade = async (from: Player, to: Player, at: Date) => {
      const sessionId = await openSession(from, to, at);
      const [tf, tt] = [trader(from, sessionId, at), trader(to, sessionId, at)];
      ok(await tf.credits(1));
      ok(await tf.ready());
      ok(await tt.ready());
      ok(await tf.confirm());
      ok(await tt.confirm());
      return sessionId;
    };
    const first = await trade(a, b, now);
    const second = await trade(c, a, plus(now, 1_000));

    const byId = await audit.findTradeAudit(first);
    expect(byId).toMatchObject({
      tradeId: first,
      requester: { characterId: a.character.id, offer: { credits: 1, stacks: [], items: [] } },
      recipient: { characterId: b.character.id, offer: { credits: 0 } },
    });
    expect(await audit.findTradeAudit(randomUUID())).toBeUndefined();

    const ids = (records: { tradeId: string }[]) => records.map((record) => record.tradeId);
    expect(ids(await audit.listTradeAuditsForAccount(a.character.playerAccountId))).toEqual([
      second,
      first,
    ]);
    expect(ids(await audit.listTradeAuditsForAccount(b.character.playerAccountId))).toEqual([
      first,
    ]);
    expect(ids(await audit.listTradeAuditsForCharacter(a.character.id))).toEqual([second, first]);
    expect(ids(await audit.listTradeAuditsForCharacter(c.character.id))).toEqual([second]);
  });

  // --- realtime ---------------------------------------------------------------

  it("prompts both participants after every committed change and never for a refusal", async () => {
    const now = new Date();
    const [a, b, bystander] = [await player(), await player(), await player()];
    await setCredits(a, 10);
    const sessionId = await openSession(a, b, now);
    const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];

    type Delivery = { type: string; change: string; statusAtDelivery?: string };
    const watch = async (run: () => Promise<unknown>) => {
      const fanout = realtime.getRealtimeFanout();
      const received = new Map<string, Delivery[]>();
      const pending: Promise<void>[] = [];
      const unsubscribes = [a, b, bystander].map(({ character }) => {
        received.set(character.id, []);
        return fanout.subscribe({
          scope: { playerAccountId: character.playerAccountId, characterId: character.id },
          deliver: (envelope) => {
            const data = envelope.data as { sessionId: string; change: string };
            const delivery: Delivery = { type: envelope.type, change: data.change };
            received.get(character.id)!.push(delivery);
            pending.push(
              sessionRow(data.sessionId).then((row) => {
                delivery.statusAtDelivery = row.status;
              }),
            );
          },
          close: () => {},
        });
      });
      try {
        await run();
        await Promise.all(pending);
      } finally {
        for (const unsubscribe of unsubscribes) unsubscribe();
      }
      expect(received.get(bystander.character.id)).toEqual([]);
      const forA = received.get(a.character.id)!;
      expect(received.get(b.character.id)).toEqual(forA);
      return forA;
    };

    expect(await watch(() => ta.credits(3))).toEqual([
      { type: "trade.session", change: "updated", statusAtDelivery: "active" },
    ]);
    expect(await watch(() => ta.credits(99))).toEqual([]);
    expect(await watch(() => ta.ready(1))).toEqual([]);
    await watch(() => ta.ready());
    await watch(() => tb.ready());
    await watch(() => tb.confirm());
    expect(await watch(() => ta.confirm())).toEqual([
      { type: "trade.session", change: "completed", statusAtDelivery: "completed" },
    ]);
    // A retry after completion changes nothing, so it prompts no one.
    expect(await watch(() => ta.confirm())).toEqual([]);
  });

  // --- #268: what the trade UI reconciles from durable state ----------------

  describe("issue #268 durable trade outcomes", () => {
    it("tells both participants how their last trade ended, and exactly what a commit moved", async () => {
      const now = new Date();
      const [a, b] = [await player(), await player()];
      await setCredits(a, 30);
      await addStack(a, SHALE, 6);
      const cutter = await addUnique(a, SALVAGE, 7);
      const sessionId = await openSession(a, b, now);
      const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
      // Nothing has ended while the session is active.
      expect((await ta.state()).ended).toBeNull();

      ok(await ta.credits(12));
      ok(await ta.addStack(SHALE, 4));
      ok(await ta.addItem(cutter));
      ok(await ta.ready());
      ok(await tb.ready());
      ok(await tb.confirm());
      ok(await ta.confirm());

      const [forA, forB] = [await ta.state(), await tb.state()];
      expect(forA.session).toBeNull();
      expect(forA.ended).toMatchObject({
        id: sessionId,
        counterpart: {
          characterId: b.character.id,
          name: b.character.displayName,
          playerName: expect.stringMatching(/^settle-/),
        },
        outcome: "completed",
        canceledByYou: false,
      });
      const gave = {
        credits: 12,
        stacks: [{ itemId: SHALE, quantity: 4 }],
        // The instance now belongs to B, with its charge intact.
        items: [{ itemInstanceId: cutter, itemId: SALVAGE, currentCharge: 7 }],
      };
      const nothing = { credits: 0, stacks: [], items: [] };
      expect(forA.ended!.exchange).toEqual({ gave, received: nothing });
      expect(forB.ended).toMatchObject({ id: sessionId, outcome: "completed" });
      expect(forB.ended!.exchange).toEqual({ gave: nothing, received: gave });
      expect(forB.ended!.endedAt).toBe(forA.ended!.endedAt);

      // Once the Cutter moves on, the exchange still names it but no longer
      // reports the state of something neither participant holds.
      const elsewhere = await player();
      await db
        .update(rune.itemInstances)
        .set({ characterId: elsewhere.character.id, currentCharge: 2 })
        .where(eq(rune.itemInstances.id, cutter));
      const later = (await ta.state()).ended!.exchange!.gave.items;
      expect(later).toEqual([{ itemInstanceId: cutter, itemId: SALVAGE }]);
    });

    it("says who canceled, reads an idle session as expired, and never leaks another trade", async () => {
      const now = new Date();
      const [a, b, c] = [await player(), await player(), await player()];
      const first = await openSession(a, b, now);
      ok(await trader(b, first, now).cancel());
      expect((await trader(a, first, now).state()).ended).toMatchObject({
        id: first,
        outcome: "canceled",
        canceledByYou: false,
      });
      expect((await trader(b, first, now).state()).ended).toMatchObject({
        id: first,
        outcome: "canceled",
        canceledByYou: true,
      });
      expect((await trader(a, first, now).state()).ended!.exchange).toBeUndefined();

      // A later session is the one reported, and an idle one reads as expired
      // before anything has written the expiry down.
      const second = await openSession(a, c, plus(now, 1_000));
      const later = plus(now, 6 * MINUTE);
      const view = await trader(a, second, later).state();
      expect(view.session).toBeNull();
      expect(view.ended).toMatchObject({ id: second, outcome: "expired" });
      expect((await sessionRow(second)).status).toBe("active");
      // B's last trade is still the canceled one; it never sees A and C's.
      const forB = await trader(b, first, later).state();
      expect(forB.ended?.id).toBe(first);
      expect(JSON.stringify(forB)).not.toContain(second);
    });

    it("explains a refused settlement to both participants until an offer changes", async () => {
      const now = new Date();
      const [a, b] = [await player(), await player()];
      const box = await addUnique(a, SCRAP_BOX);
      await fillInventory(b);
      const sessionId = await openSession(a, b, now);
      const [ta, tb] = [trader(a, sessionId, now), trader(b, sessionId, now)];
      ok(await ta.addItem(box));
      ok(await ta.ready());
      ok(await tb.ready());
      // B confirms first; A's final Confirm finds B's Inventory full.
      ok(await tb.confirm());
      expect(refusal(await ta.confirm())).toBe("inventory_full");

      const [forA, forB] = [(await ta.state()).session!, (await tb.state()).session!];
      expect(forA.phase).toBe("compose");
      expect([forA.yours.ready, forA.theirs.ready, forB.yours.confirmed]).toEqual([
        false,
        false,
        false,
      ]);
      // Each participant reads it from its own side; the first confirmer learns
      // its own Inventory is the problem.
      expect(forA.settlementRefusal).toEqual({
        reason: "inventory_full",
        message: `${b.character.displayName}'s Inventory wouldn't have room for this trade. Nothing moved. Adjust the offers and Ready again.`,
      });
      expect(forB.settlementRefusal).toEqual({
        reason: "inventory_full",
        message:
          "Your Inventory wouldn't have room for this trade. Nothing moved. Adjust the offers and Ready again.",
      });

      // Ready again on the same offers keeps it; the next offer change clears it.
      ok(await tb.ready());
      expect((await tb.state()).session!.settlementRefusal?.reason).toBe("inventory_full");
      ok(await ta.removeItem(box));
      expect((await ta.state()).session!.settlementRefusal).toBeUndefined();
      expect((await tb.state()).session!.settlementRefusal).toBeUndefined();
      const row = await sessionRow(sessionId);
      expect([row.settlementRefusal, row.settlementRefusalSide]).toEqual([null, null]);
    });
  });
});
