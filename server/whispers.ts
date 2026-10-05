import { and, count, desc, eq, gt, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  characters,
  chatMessages,
  playerBlocks,
  whisperConversations,
  whisperParticipants,
  type Character,
  asPlayerChatMessage,
  type ChatMessage,
} from "@/db/rune-space";
import { CHAT_POLICY, chatRetentionCutoff, whisperParticipantKey } from "@/game/domain/chat";
import type {
  CharacterTarget,
  OpenWhisperResult,
  WhisperHistoryPage,
  WhisperInbox,
  WhisperMessageView,
  WhisperPeer,
  WhisperSendRefusalReason,
  WhisperSendResult,
} from "@/game/schemas/whispers";
import { beginChatSend, budgetFrom, recentSendTimes, type ChatSendOptions } from "@/server/chat";
import { requirePlayableOwnedCharacter } from "@/server/gameplay-access";
import { blockBetween } from "@/server/player-blocks";
import { publishRealtimeEvent } from "@/server/realtime";
import { CHARACTER_TARGET_NOT_FOUND, resolveCharacterTarget } from "@/server/social-targets";

/**
 * The authoritative Whisper boundary (issue #247): 1:1 character-to-character
 * Direct Messages.
 *
 * A Whisper is a `whisper` row in `chat_messages` bound to one
 * `whisper_conversations` pair, so it shares public chat's immutable message
 * contract, the one account-wide send budget and its lock (`beginChatSend`),
 * the severe-term guardrail, and 90-day retention. Every entry re-runs
 * `requirePlayableOwnedCharacter`; sender identity comes from those rows.
 *
 * Participants are stored by stable character and account ids, so renames
 * never break a conversation; each message keeps the sender's name at send.
 * A Block in either direction prevents new Whispers but never hides history,
 * and a Block by the other account is never disclosed: its refusal reads like
 * any undeliverable Whisper. A send commits first and only then is published
 * to both participant characters; a recipient who is offline reads it from
 * history on return. Unread is durable per recipient character.
 *
 * Either side may hide a conversation from its own inbox (#261). Hiding is a
 * marker on that side's participant row only: no message is deleted or
 * altered, the other side sees no change, and Report evidence and moderation
 * reads are untouched. The next message from either character, or reopening
 * the conversation by name or from a chat sender, brings it back.
 */

/** Refusal for a Whisper read that names no addressable character. */
export class WhisperError extends Error {
  constructor(message: string = CHARACTER_TARGET_NOT_FOUND) {
    super(message);
    this.name = "WhisperError";
  }
}

const SELF_REFUSAL = "You can't whisper your own characters.";
const NO_SUCH_CHARACTER = "No character has that name.";
const UNDELIVERABLE = "Your Whisper couldn't be delivered.";

function toView(message: ChatMessage, recipientCharacterId: string): WhisperMessageView {
  const row = asPlayerChatMessage(message);
  return {
    id: row.id,
    seq: row.seq,
    senderCharacterId: row.senderCharacterId,
    recipientCharacterId,
    senderName: row.senderCharacterName,
    body: row.body,
    sentAt: row.createdAt.toISOString(),
  };
}

/** The other character of a message between `a` and `b`. */
function otherOf(row: Pick<ChatMessage, "senderCharacterId">, a: string, b: string): string {
  return row.senderCharacterId === a ? b : a;
}

async function peerOf(me: Character, other: Character): Promise<WhisperPeer> {
  const { iBlockedThem } = await blockBetween(me.playerAccountId, other.playerAccountId);
  return { characterId: other.id, name: other.displayName, blockedByMe: iBlockedThem };
}

async function requirePeer(me: Character, withCharacterId: string): Promise<Character> {
  const other = await resolveCharacterTarget({ characterId: withCharacterId }, me);
  if (!other) throw new WhisperError();
  if (other.playerAccountId === me.playerAccountId) throw new WhisperError(SELF_REFUSAL);
  return other;
}

async function conversationIdFor(
  executor: Pick<typeof db, "select">,
  a: string,
  b: string,
): Promise<string | undefined> {
  const [row] = await executor
    .select({ id: whisperConversations.id })
    .from(whisperConversations)
    .where(eq(whisperConversations.participantKey, whisperParticipantKey(a, b)))
    .limit(1);
  return row?.id;
}

/**
 * Resolve the character a player wants to Whisper: a chat sender, the
 * same-location profile, or an exact character name typed in the Whispers
 * tab. A Whisper may go to any character by name — nearby or not, online or
 * not — so names resolve game-wide here (exact match only, never a search).
 * Nothing is persisted: a conversation begins with its first Whisper, so
 * merely opening one never makes contact, and a Block by the other account
 * is not revealed here either.
 */
export async function openWhisper(
  userId: string,
  characterId: string,
  target: CharacterTarget,
): Promise<OpenWhisperResult> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const other = await resolveCharacterTarget(target, me, { names: "anywhere" });
  if (!other) return { error: NO_SUCH_CHARACTER };
  if (other.playerAccountId === me.playerAccountId) return { error: SELF_REFUSAL };
  // Reopening a conversation this character hid (#261) puts it back in its
  // own inbox. Nothing is sent and the other side is not touched.
  const conversationId = await conversationIdFor(db, me.id, other.id);
  if (conversationId) {
    const unhidden = await db
      .update(whisperParticipants)
      .set({ hiddenThroughSeq: null })
      .where(
        and(
          eq(whisperParticipants.conversationId, conversationId),
          eq(whisperParticipants.characterId, me.id),
          isNotNull(whisperParticipants.hiddenThroughSeq),
        ),
      )
      .returning({ conversationId: whisperParticipants.conversationId });
    if (unhidden.length > 0) publishInboxChanged(me.id, other.id);
  }
  return { status: "ready", peer: await peerOf(me, other) };
}

/** Tell the character's tabs to re-read their inbox. An invalidation only. */
function publishInboxChanged(characterId: string, withCharacterId: string) {
  publishRealtimeEvent({ kind: "character", characterId }, "whisper.read", { withCharacterId });
}

/** Send one Whisper from the active character. */
export async function sendWhisper(
  userId: string,
  characterId: string,
  request: { recipientCharacterId: string; text: string },
  { now = new Date(), denylist }: ChatSendOptions = {},
): Promise<WhisperSendResult> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const accountId = me.playerAccountId;

  const result = await db.transaction(async (tx): Promise<WhisperSendResult> => {
    const begun = await beginChatSend(tx, accountId, "whisper", request.text, { now, denylist });
    const refuse = (reason: WhisperSendRefusalReason, error: string): WhisperSendResult => ({
      status: "refused",
      reason,
      error,
      budget: budgetFrom(begun.sends, now),
    });
    if (!begun.ok) return refuse(begun.reason, begun.error);

    const [recipient] = await tx
      .select()
      .from(characters)
      .where(eq(characters.id, request.recipientCharacterId))
      .limit(1);
    if (!recipient) return refuse("undeliverable", UNDELIVERABLE);
    if (recipient.playerAccountId === accountId) return refuse("undeliverable", SELF_REFUSAL);
    const block = await blockBetween(accountId, recipient.playerAccountId, tx);
    if (block.iBlockedThem) {
      return refuse(
        "blocked_by_you",
        `You blocked ${recipient.displayName}. Unblock them to send a Whisper.`,
      );
    }
    // Never disclosed: indistinguishable from any other undeliverable Whisper.
    if (block.theyBlockedMe) return refuse("undeliverable", UNDELIVERABLE);

    const participantKey = whisperParticipantKey(me.id, recipient.id);
    await tx.insert(whisperConversations).values({ participantKey }).onConflictDoNothing();
    const conversationId = (await conversationIdFor(tx, me.id, recipient.id))!;
    await tx
      .insert(whisperParticipants)
      .values([
        { conversationId, characterId: me.id, playerAccountId: accountId },
        {
          conversationId,
          characterId: recipient.id,
          playerAccountId: recipient.playerAccountId,
        },
      ])
      .onConflictDoNothing();

    const [row] = await tx
      .insert(chatMessages)
      .values({
        channel: "whisper",
        conversationId,
        senderPlayerAccountId: accountId,
        senderCharacterId: me.id,
        senderCharacterName: me.displayName,
        body: begun.body,
        createdAt: now,
      })
      .returning();
    return {
      status: "sent",
      message: toView(row!, recipient.id),
      budget: budgetFrom([...begun.sends, now.getTime()], now),
    };
  });

  if (result.status === "sent") {
    // After commit: a prompt to both participants' open tabs, never the ledger.
    const message = result.message;
    publishRealtimeEvent(
      { kind: "character", characterId: message.recipientCharacterId },
      "whisper.message",
      message,
    );
    publishRealtimeEvent(
      { kind: "character", characterId: message.senderCharacterId },
      "whisper.message",
      message,
    );
  }
  return result;
}

/**
 * One page of the conversation with `withCharacterId`: the latest page, or
 * with `before` the page strictly older than that message. Oldest first.
 * Expired rows never render. A pair with no conversation yet is an empty page.
 */
export async function readWhisperHistory(
  userId: string,
  characterId: string,
  request: { withCharacterId: string; before?: number },
  now: Date = new Date(),
): Promise<WhisperHistoryPage> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const other = await requirePeer(me, request.withCharacterId);
  const conversationId = await conversationIdFor(db, me.id, other.id);
  const rows = conversationId
    ? await db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.conversationId, conversationId),
            gte(chatMessages.createdAt, new Date(chatRetentionCutoff(now.getTime()))),
            request.before === undefined ? undefined : lt(chatMessages.seq, request.before),
          ),
        )
        .orderBy(desc(chatMessages.seq))
        .limit(CHAT_POLICY.pageSize + 1)
    : [];
  const page = rows.slice(0, CHAT_POLICY.pageSize);
  const sends = await recentSendTimes(db, me.playerAccountId, now);
  return {
    peer: await peerOf(me, other),
    messages: page.reverse().map((row) => toView(row, otherOf(row, me.id, other.id))),
    hasOlder: rows.length > CHAT_POLICY.pageSize,
    budget: budgetFrom(sends, now),
  };
}

/**
 * Advance the active character's read position in a conversation through
 * `throughSeq` (capped at the conversation's newest message, never moved
 * back). Reading on one tab or device clears that character's unread
 * everywhere: its other tabs are told to re-read.
 */
export async function markWhisperRead(
  userId: string,
  characterId: string,
  request: { withCharacterId: string; throughSeq: number },
): Promise<{ status: "read" }> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const other = await requirePeer(me, request.withCharacterId);
  const conversationId = await conversationIdFor(db, me.id, other.id);
  if (!conversationId) return { status: "read" };
  // Never past the newest message, and never backwards.
  const target = sql`least(${request.throughSeq}::bigint, (select coalesce(max(${chatMessages.seq}), 0) from ${chatMessages} where ${chatMessages.conversationId} = ${conversationId}))`;
  const advanced = await db
    .update(whisperParticipants)
    .set({ lastReadSeq: target })
    .where(
      and(
        eq(whisperParticipants.conversationId, conversationId),
        eq(whisperParticipants.characterId, me.id),
        sql`${whisperParticipants.lastReadSeq} < ${target}`,
      ),
    )
    .returning({ lastReadSeq: whisperParticipants.lastReadSeq });
  if (advanced.length > 0) publishInboxChanged(me.id, other.id);
  return { status: "read" };
}

/**
 * Hide the conversation with `withCharacterId` from the active character's
 * inbox (#261) through `throughSeq` — the newest message this tab showed,
 * capped at the conversation's newest — and mark everything through it read,
 * so a hidden conversation never holds unread. A message newer than that, from
 * either side, shows the conversation again; so does reopening it. Only this
 * character's participant row changes: no message is deleted, and the other
 * side's inbox and unread are exactly as they were.
 */
export async function hideWhisperConversation(
  userId: string,
  characterId: string,
  request: { withCharacterId: string; throughSeq: number },
): Promise<{ status: "hidden" }> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const other = await requirePeer(me, request.withCharacterId);
  const conversationId = await conversationIdFor(db, me.id, other.id);
  if (!conversationId) return { status: "hidden" };
  const target = sql`least(${request.throughSeq}::bigint, (select coalesce(max(${chatMessages.seq}), 0) from ${chatMessages} where ${chatMessages.conversationId} = ${conversationId}))`;
  await db
    .update(whisperParticipants)
    .set({
      hiddenThroughSeq: target,
      lastReadSeq: sql`greatest(${whisperParticipants.lastReadSeq}, ${target})`,
    })
    .where(
      and(
        eq(whisperParticipants.conversationId, conversationId),
        eq(whisperParticipants.characterId, me.id),
      ),
    );
  publishInboxChanged(me.id, other.id);
  return { status: "hidden" };
}

/**
 * The active character's conversations with at least one retained Whisper,
 * most recent first, with each one's durable unread count. A conversation the
 * character hid (#261) is left out until a newer message arrives.
 */
export async function readWhisperInbox(
  userId: string,
  characterId: string,
  now: Date = new Date(),
): Promise<WhisperInbox> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const cutoff = new Date(chatRetentionCutoff(now.getTime()));
  const other = alias(whisperParticipants, "other_participant");

  const participations = await db
    .select({
      conversationId: whisperParticipants.conversationId,
      lastReadSeq: whisperParticipants.lastReadSeq,
      hiddenThroughSeq: whisperParticipants.hiddenThroughSeq,
      peerId: characters.id,
      peerName: characters.displayName,
      peerAccountId: other.playerAccountId,
    })
    .from(whisperParticipants)
    .innerJoin(
      other,
      and(
        eq(other.conversationId, whisperParticipants.conversationId),
        ne(other.characterId, whisperParticipants.characterId),
      ),
    )
    .innerJoin(characters, eq(characters.id, other.characterId))
    .where(eq(whisperParticipants.characterId, me.id));
  if (participations.length === 0) return { conversations: [], unreadTotal: 0 };
  const conversationIds = participations.map((row) => row.conversationId);

  const [latest, unread, blocked] = await Promise.all([
    db
      .selectDistinctOn([chatMessages.conversationId])
      .from(chatMessages)
      .where(
        and(
          inArray(chatMessages.conversationId, conversationIds),
          gte(chatMessages.createdAt, cutoff),
        ),
      )
      .orderBy(chatMessages.conversationId, desc(chatMessages.seq)),
    db
      .select({ conversationId: chatMessages.conversationId, unread: count() })
      .from(chatMessages)
      .innerJoin(
        whisperParticipants,
        and(
          eq(whisperParticipants.conversationId, chatMessages.conversationId),
          eq(whisperParticipants.characterId, me.id),
        ),
      )
      .where(
        and(
          inArray(chatMessages.conversationId, conversationIds),
          ne(chatMessages.senderCharacterId, me.id),
          gt(chatMessages.seq, whisperParticipants.lastReadSeq),
          gte(chatMessages.createdAt, cutoff),
        ),
      )
      .groupBy(chatMessages.conversationId),
    db
      .select({ blocked: playerBlocks.blockedPlayerAccountId })
      .from(playerBlocks)
      .where(eq(playerBlocks.blockerPlayerAccountId, me.playerAccountId)),
  ]);

  const latestBy = new Map(latest.map((row) => [row.conversationId!, row]));
  const unreadBy = new Map(unread.map((row) => [row.conversationId!, row.unread]));
  const blockedAccounts = new Set(blocked.map((row) => row.blocked));
  const conversations = participations
    .flatMap((row) => {
      const last = latestBy.get(row.conversationId);
      if (!last) return [];
      if (row.hiddenThroughSeq !== null && last.seq <= row.hiddenThroughSeq) return [];
      return [
        {
          peer: {
            characterId: row.peerId,
            name: row.peerName,
            blockedByMe: blockedAccounts.has(row.peerAccountId),
          },
          unread: unreadBy.get(row.conversationId) ?? 0,
          lastMessage: toView(last, otherOf(last, me.id, row.peerId)),
        },
      ];
    })
    .sort((a, b) => b.lastMessage.seq - a.lastMessage.seq);
  return {
    conversations,
    unreadTotal: conversations.reduce((sum, conversation) => sum + conversation.unread, 0),
  };
}
