import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Character } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";
import type { TradeCommandResult, TradeStateView } from "@/game/schemas/player-trade";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * The item type the shared rule currently refuses. Empty means every item is
 * transferable, which is exactly what the real rule says today.
 */
const restricted = vi.hoisted(() => ({ itemId: "" }));

vi.mock("@/game/domain/player-trade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/game/domain/player-trade")>();
  return {
    ...actual,
    isItemTransferable: (
      itemId: string,
      balance?: Parameters<typeof actual.isItemTransferable>[1],
    ) => itemId !== restricted.itemId && actual.isItemTransferable(itemId, balance),
  };
});

const token = () => Math.random().toString(36).slice(2, 8);
const { items, carrying } = getEffectiveGameBalance();
const SHALE = items.ferriteShale.itemId;
const SALVAGE = items.salvageCutter.itemId;

type Player = { userId: string; character: Character };

/**
 * Issue #326: the server's offer commands and final settlement consult the one
 * item-level eligibility rule, `isItemTransferable`, the same one the
 * item-source reference's "Player trade" entry reads. Where a copy of the item
 * is (equipped, Cargo Hold, stash) stays a separate check, covered in
 * `player-trade-settlement.test.ts`.
 */
suite("issue #326 item-level transferability in trade enforcement (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let trades: typeof import("@/server/player-trades");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    trades = await import("@/server/player-trades");
  });

  afterEach(async () => {
    restricted.itemId = "";
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function player(): Promise<Player> {
    const userId = await createTestUser(db, authSchema, `xfer-${token()}`);
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Xfr${token()}`,
    );
    const [pack] = await db
      .insert(rune.itemInstances)
      .values({ characterId: character.id, itemId: items.starterContainer.itemId })
      .returning();
    await db.insert(rune.equippedItems).values({
      characterId: character.id,
      assignmentKind: "container",
      suitSlotId: carrying.containerSuitSlotIds[0],
      itemInstanceId: pack!.id,
    });
    return { userId, character };
  }

  function ok(result: TradeCommandResult): TradeStateView {
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.reason}`);
    return result.state;
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

  async function version(sessionId: string) {
    const [row] = await db
      .select({ offerVersion: rune.playerTradeSessions.offerVersion })
      .from(rune.playerTradeSessions)
      .where(eq(rune.playerTradeSessions.id, sessionId));
    return row!.offerVersion;
  }

  async function shaleHeld(who: Player) {
    const rows = await db
      .select({ quantity: rune.inventoryStacks.quantity })
      .from(rune.inventoryStacks)
      .where(
        and(
          eq(rune.inventoryStacks.characterId, who.character.id),
          eq(rune.inventoryStacks.itemId, SHALE),
        ),
      );
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  it("refuses to offer a stack or a unique item the rule excludes, and writes nothing", async () => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    const a = await player();
    const b = await player();
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId: a.character.id, itemId: SHALE, quantity: 4 });
    const [cutter] = await db
      .insert(rune.itemInstances)
      .values({ characterId: a.character.id, itemId: SALVAGE })
      .returning();
    const sessionId = await openSession(a, b, now);

    restricted.itemId = SHALE;
    const stack = await trades.addTradeOfferStack(
      a.userId,
      a.character.id,
      sessionId,
      await version(sessionId),
      SHALE,
      2,
      now,
    );
    expect(stack).toMatchObject({ status: "refused", reason: "invalid_offer" });

    restricted.itemId = SALVAGE;
    const unique = await trades.addTradeOfferItem(
      a.userId,
      a.character.id,
      sessionId,
      await version(sessionId),
      cutter!.id,
      now,
    );
    expect(unique).toMatchObject({ status: "refused", reason: "invalid_offer" });
    expect(await version(sessionId)).toBe(1);

    // Under the real rule both offers are accepted: the refusals were the rule's.
    restricted.itemId = "";
    ok(
      await trades.addTradeOfferStack(
        a.userId,
        a.character.id,
        sessionId,
        await version(sessionId),
        SHALE,
        2,
        now,
      ),
    );
  });

  it("refuses at settlement an offer whose item type became ineligible, moving nothing", async () => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    const a = await player();
    const b = await player();
    await db
      .insert(rune.inventoryStacks)
      .values({ characterId: a.character.id, itemId: SHALE, quantity: 4 });
    const sessionId = await openSession(a, b, now);
    ok(
      await trades.addTradeOfferStack(
        a.userId,
        a.character.id,
        sessionId,
        await version(sessionId),
        SHALE,
        2,
        now,
      ),
    );
    for (const who of [a, b]) {
      ok(
        await trades.readyTradeOffer(
          who.userId,
          who.character.id,
          sessionId,
          await version(sessionId),
          now,
        ),
      );
    }
    ok(
      await trades.confirmTrade(a.userId, a.character.id, sessionId, await version(sessionId), now),
    );

    restricted.itemId = SHALE;
    await trades.confirmTrade(b.userId, b.character.id, sessionId, await version(sessionId), now);

    expect(await shaleHeld(a)).toBe(4);
    expect(await shaleHeld(b)).toBe(0);
    const [session] = await db
      .select({ status: rune.playerTradeSessions.status })
      .from(rune.playerTradeSessions)
      .where(eq(rune.playerTradeSessions.id, sessionId));
    expect(session?.status).toBe("active");
  });
});
