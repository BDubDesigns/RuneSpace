import { and, desc, eq, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
  characters,
  playerAccounts,
  playerBlockEvents,
  playerBlocks,
  type Character,
} from "@/db/rune-space";
import type { CharacterTarget } from "@/game/schemas/whispers";
import type { BlockedPlayersView, BlockResult } from "@/game/schemas/social-safety";
import { lockAccountChatSends } from "@/server/chat-send-lock";
import { requirePlayableOwnedCharacter } from "@/server/gameplay-access";
import { publishRealtimeEvent } from "@/server/realtime";
import { CHARACTER_TARGET_NOT_FOUND, resolveCharacterTarget } from "@/server/social-targets";

/**
 * Account-level Block (issue #247): "I do not want this account interacting
 * with me." The UI is character-facing, but a Block is stored and enforced
 * between accounts, so it covers every character of both and switching
 * characters never evades it.
 *
 * A Block hides the blocked account's General/Trade messages from the blocker
 * only (`notBlockedByViewer` for reads, `accountsBlocking` for live delivery),
 * prevents Whispers in either direction (`isBlockedBetween`), and is the seam
 * trade requests (#225) reuse to refuse direct contact. It never erases prior
 * Whisper history, is never disclosed to the blocked player, and lasts until
 * the blocker unblocks. Every block and unblock appends a `player_block_events`
 * row as an interpretable safety signal; nothing here sanctions anyone.
 */

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<Transaction, "select">;

/**
 * SQL that is true for a row whose sender account the viewer has NOT blocked.
 * Public chat reads (`server/chat.ts`) filter with it so pages stay full and
 * cursors stay exact.
 */
export function notBlockedByViewer(viewerAccountId: string, senderAccountColumn: SQLWrapper): SQL {
  return sql`not exists (select 1 from ${playerBlocks} where ${playerBlocks.blockerPlayerAccountId} = ${viewerAccountId} and ${playerBlocks.blockedPlayerAccountId} = ${senderAccountColumn})`;
}

/** Every account that currently blocks `blockedAccountId`. */
export async function accountsBlocking(
  blockedAccountId: string,
  executor: Executor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ id: playerBlocks.blockerPlayerAccountId })
    .from(playerBlocks)
    .where(eq(playerBlocks.blockedPlayerAccountId, blockedAccountId));
  return rows.map((row) => row.id);
}

/**
 * Which way, if any, a Block stands between two accounts. Direct social
 * contact — a Whisper now, a trade request in #225 — is allowed only when
 * neither is true. Callers must keep `theyBlockedMe` to themselves.
 */
export async function blockBetween(
  accountId: string,
  otherAccountId: string,
  executor: Executor = db,
): Promise<{ iBlockedThem: boolean; theyBlockedMe: boolean }> {
  const rows = await executor
    .select({ blocker: playerBlocks.blockerPlayerAccountId })
    .from(playerBlocks)
    .where(
      or(
        and(
          eq(playerBlocks.blockerPlayerAccountId, accountId),
          eq(playerBlocks.blockedPlayerAccountId, otherAccountId),
        ),
        and(
          eq(playerBlocks.blockerPlayerAccountId, otherAccountId),
          eq(playerBlocks.blockedPlayerAccountId, accountId),
        ),
      ),
    );
  return {
    iBlockedThem: rows.some((row) => row.blocker === accountId),
    theyBlockedMe: rows.some((row) => row.blocker === otherAccountId),
  };
}

/** True when either account blocks the other: no direct contact between them. */
export async function isBlockedBetween(
  accountId: string,
  otherAccountId: string,
  executor: Executor = db,
): Promise<boolean> {
  const state = await blockBetween(accountId, otherAccountId, executor);
  return state.iBlockedThem || state.theyBlockedMe;
}

/**
 * Record a Block inside the caller's transaction. Idempotent: an existing
 * Block is left as it was and appends no second event. Returns whether this
 * call created it.
 */
export async function recordBlock(
  tx: Pick<Transaction, "insert" | "execute">,
  blocker: Pick<Character, "id" | "playerAccountId">,
  blocked: Pick<Character, "id" | "playerAccountId">,
  now: Date,
): Promise<boolean> {
  // Wait out any Whisper the blocked account is sending right now, so nothing
  // it sends is delivered after the blocker has been told the Block stands.
  await lockAccountChatSends(tx, blocked.playerAccountId);
  const inserted = await tx
    .insert(playerBlocks)
    .values({
      blockerPlayerAccountId: blocker.playerAccountId,
      blockedPlayerAccountId: blocked.playerAccountId,
      blockerCharacterId: blocker.id,
      blockedCharacterId: blocked.id,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ blocker: playerBlocks.blockerPlayerAccountId });
  if (inserted.length === 0) return false;
  await tx.insert(playerBlockEvents).values({
    kind: "block",
    blockerPlayerAccountId: blocker.playerAccountId,
    blockedPlayerAccountId: blocked.playerAccountId,
    blockerCharacterId: blocker.id,
    blockedCharacterId: blocked.id,
    createdAt: now,
  });
  return true;
}

/**
 * Tell every tab of the blocker's account to re-read what a Block changes.
 * Only the blocker's own account is addressed; the blocked player's tabs never
 * hear anything.
 */
export function publishBlocksChanged(blockerAccountId: string) {
  publishRealtimeEvent({ kind: "account", playerAccountId: blockerAccountId }, "safety.blocks", {});
}

const SELF_REFUSAL = "You can't block your own characters.";

/** Block the account behind a character-facing target. */
export async function blockPlayer(
  userId: string,
  characterId: string,
  target: CharacterTarget,
  now: Date = new Date(),
): Promise<BlockResult> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  const blocked = await resolveCharacterTarget(target, character);
  if (!blocked) return { error: CHARACTER_TARGET_NOT_FOUND };
  if (blocked.playerAccountId === character.playerAccountId) return { error: SELF_REFUSAL };
  const created = await db.transaction((tx) => recordBlock(tx, character, blocked, now));
  if (created) publishBlocksChanged(character.playerAccountId);
  return { status: "blocked", name: blocked.displayName };
}

/**
 * Unblock the account behind a character from the Blocked Players list,
 * restoring ordinary interaction. Idempotent.
 */
export async function unblockPlayer(
  userId: string,
  characterId: string,
  blockedCharacterId: string,
  now: Date = new Date(),
): Promise<BlockResult> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  const blocked = await resolveCharacterTarget({ characterId: blockedCharacterId }, character);
  if (!blocked) return { error: CHARACTER_TARGET_NOT_FOUND };
  const removed = await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(playerBlocks)
      .where(
        and(
          eq(playerBlocks.blockerPlayerAccountId, character.playerAccountId),
          eq(playerBlocks.blockedPlayerAccountId, blocked.playerAccountId),
        ),
      )
      .returning({ blocker: playerBlocks.blockerPlayerAccountId });
    if (deleted.length === 0) return false;
    await tx.insert(playerBlockEvents).values({
      kind: "unblock",
      blockerPlayerAccountId: character.playerAccountId,
      blockedPlayerAccountId: blocked.playerAccountId,
      blockerCharacterId: character.id,
      blockedCharacterId: blocked.id,
      createdAt: now,
    });
    return true;
  });
  if (removed) publishBlocksChanged(character.playerAccountId);
  return { status: "unblocked", name: blocked.displayName };
}

/** The viewer account's Blocked Players, most recent first. */
export async function listBlockedPlayers(
  userId: string,
  characterId: string,
): Promise<BlockedPlayersView> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  const rows = await db
    .select({
      characterId: characters.id,
      name: characters.displayName,
      playerName: user.displayUsername,
      blockedAt: playerBlocks.createdAt,
    })
    .from(playerBlocks)
    .innerJoin(characters, eq(characters.id, playerBlocks.blockedCharacterId))
    .innerJoin(playerAccounts, eq(playerAccounts.id, playerBlocks.blockedPlayerAccountId))
    .innerJoin(user, eq(user.id, playerAccounts.userId))
    .where(eq(playerBlocks.blockerPlayerAccountId, character.playerAccountId))
    .orderBy(desc(playerBlocks.createdAt));
  return {
    blocked: rows.map((row) => ({
      characterId: row.characterId,
      name: row.name,
      playerName: row.playerName,
      blockedAt: row.blockedAt.toISOString(),
    })),
  };
}
