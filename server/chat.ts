import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  characters,
  chatMessageMentions,
  chatMessages,
  type Character,
  type ChatMessage,
} from "@/db/rune-space";
import {
  CHAT_POLICY,
  chatRetentionCutoff,
  decideChatSend,
  namesShownAsMentions,
  normalizeChatMessage,
  promotedAdCooldownRemaining,
  recentChatSends,
  type ChatChannel,
  type ChatSendChannel,
} from "@/game/domain/chat";
import type {
  ChatHistoryPage,
  ChatMentionsView,
  ChatMentionView,
  ChatSendBudget,
  ChatSendRefusalReason,
  ChatSendResult,
  PromotedAdStatus,
  RedactedChatMessageView,
  VisibleChatMessageView,
} from "@/game/schemas/chat";
import type { CharacterTarget } from "@/game/schemas/whispers";
import { containsSevereTerm } from "@/server/chat-guardrail";
import { lockAccountChatSends } from "@/server/chat-send-lock";
import { requirePlayableOwnedCharacter } from "@/server/gameplay-access";
import { isSociallyRestricted, SOCIALLY_RESTRICTED_MESSAGE } from "@/server/moderation-sanctions";
import {
  accountsBlocking,
  blockBetween,
  blockedByViewer,
  blockedEitherWay,
} from "@/server/player-blocks";
import { assertNotTradeEngaged } from "@/server/player-trade-gate";
import { publishRealtimeEvent } from "@/server/realtime";
import { resolveCharacterTarget } from "@/server/social-targets";

/**
 * The authoritative public chat boundary (issue #246): General and Trade
 * history, sends, and promoted Trade ads. It also owns the send path every
 * chat surface shares — Whispers (#247) send through `beginChatSend` too.
 *
 * Every entry re-runs `requirePlayableOwnedCharacter`, so the session, the
 * owned character, and the gameplay-access gate are checked on each request,
 * and the sender's account, character, and name are always taken from those
 * rows — the browser names only its active character.
 *
 * A send runs in one transaction behind a per-account advisory lock, so every
 * tab, device, and character of one account shares one serialized send budget
 * and one ad cooldown. The persisted row is the send: it counts toward the
 * rolling window, it is the ad's cooldown, and for an ad it commits together
 * with the Credit charge or not at all. Realtime delivery is published only
 * after that commit; the stream is never the message ledger.
 *
 * Issue #261 adds two per-viewer refinements. A message may `@mention`
 * characters: each target is resolved and checked inside the send's
 * transaction and stored with it in `chat_message_mentions`, whose durable
 * read state is the mentioned character's mention attention. And a message
 * from an account the viewer blocked is redacted for that viewer — on reads
 * and on live delivery — rather than removed, so the timeline stays whole.
 */

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<Transaction, "select" | "execute">;

/**
 * At most this many expired rows are deleted per send, so retention never
 * makes one send slow; any backlog clears over the following sends.
 */
export const CHAT_RETENTION_PRUNE_BATCH = 500;

export type ChatSendOptions = {
  now?: Date;
  /** The severe-term list; tests inject their own. */
  denylist?: ReadonlySet<string>;
};

/**
 * Which rows a channel's feed shows: its own, and in General every ad. Report
 * context (#247) reads the same feed the reporter saw.
 */
export function channelFeed(channel: ChatChannel): SQL {
  return channel === "general"
    ? or(eq(chatMessages.channel, "general"), isNotNull(chatMessages.promotedPriceCredits))!
    : eq(chatMessages.channel, "trade");
}

function toView(row: ChatMessage, mentions: readonly ChatMentionView[]): VisibleChatMessageView {
  return {
    redacted: false,
    id: row.id,
    seq: row.seq,
    channel: row.channel as ChatChannel,
    senderCharacterId: row.senderCharacterId,
    senderName: row.senderCharacterName,
    body: row.body,
    sentAt: row.createdAt.toISOString(),
    promoted: row.promotedPriceCredits !== null,
    mentions: [...mentions],
  };
}

/**
 * A message as a viewer who blocked its sender's account receives it (#261):
 * its timeline place and sender name at send, and nothing it said. Built from
 * an allow-list, so a field added to messages later is never leaked by default.
 */
function redact(
  message: Pick<
    VisibleChatMessageView,
    "id" | "seq" | "channel" | "promoted" | "senderName" | "sentAt"
  >,
): RedactedChatMessageView {
  return {
    redacted: true,
    id: message.id,
    seq: message.seq,
    channel: message.channel,
    promoted: message.promoted,
    senderName: message.senderName,
    sentAt: message.sentAt,
  };
}

/** Each listed message's mentions, by message id, in a stable order. */
async function mentionsOf(
  executor: Executor,
  messageIds: readonly string[],
): Promise<Map<string, ChatMentionView[]>> {
  const byMessage = new Map<string, ChatMentionView[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await executor
    .select({
      messageId: chatMessageMentions.messageId,
      characterId: chatMessageMentions.mentionedCharacterId,
      name: chatMessageMentions.mentionedCharacterName,
    })
    .from(chatMessageMentions)
    .where(inArray(chatMessageMentions.messageId, [...messageIds]))
    .orderBy(asc(chatMessageMentions.mentionedCharacterName));
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({ characterId: row.characterId, name: row.name });
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

/**
 * The account's successful sends still inside the rolling window: every chat
 * row it sent, General, Trade, and Whispers alike.
 */
export async function recentSendTimes(
  executor: Executor,
  playerAccountId: string,
  now: Date,
): Promise<number[]> {
  const rows = await executor
    .select({ createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.senderPlayerAccountId, playerAccountId),
        gt(chatMessages.createdAt, new Date(now.getTime() - CHAT_POLICY.sendWindowMs)),
      ),
    );
  return recentChatSends(
    rows.map((row) => row.createdAt.getTime()),
    now.getTime(),
  );
}

async function lastPromotedAt(
  executor: Executor,
  playerAccountId: string,
  now: Date,
): Promise<number | null> {
  const rows = await executor
    .select({ at: max(chatMessages.createdAt) })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.senderPlayerAccountId, playerAccountId),
        isNotNull(chatMessages.promotedPriceCredits),
        gt(chatMessages.createdAt, new Date(now.getTime() - CHAT_POLICY.promotedAd.cooldownMs)),
      ),
    );
  return rows[0]?.at?.getTime() ?? null;
}

export function budgetFrom(sends: readonly number[], now: Date): ChatSendBudget {
  return {
    recentSendExpiresInMs: sends.map((sentAt) => sentAt + CHAT_POLICY.sendWindowMs - now.getTime()),
  };
}

function adStatus(lastAd: number | null, now: Date): PromotedAdStatus {
  return {
    priceCredits: CHAT_POLICY.promotedAd.priceCredits,
    readyInMs: promotedAdCooldownRemaining(lastAd, now.getTime()),
  };
}

function secondsLabel(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
}

function minutesLabel(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

const REFUSAL_COPY: Record<
  Exclude<
    ChatSendRefusalReason,
    "rate_limited" | "ad_cooldown" | "invalid_mention" | "blocked_by_you"
  >,
  string
> = {
  socially_restricted: SOCIALLY_RESTRICTED_MESSAGE,
  empty: "Type a message first.",
  too_long: `Messages can be up to ${CHAT_POLICY.maxLength} characters.`,
  prohibited_term: "That message wasn't sent: it contains a slur RuneSpace blocks.",
  insufficient_credits: `A promoted ad costs ${CHAT_POLICY.promotedAd.priceCredits} Credits.`,
};

const MENTION_UNMATCHED = "That mention couldn't be matched. Choose the name again from the list.";
const MENTION_OWN = "You can't mention your own characters.";
const MENTION_TOO_MANY = `A message can mention up to ${CHAT_POLICY.maxMentions} characters.`;

/**
 * Delete messages past ordinary retention, oldest first, at most `limit` per
 * call. `SKIP LOCKED` lets concurrent sends prune disjoint rows instead of
 * waiting on — or deadlocking with — each other.
 */
export async function pruneExpiredChatMessages(
  executor: Pick<Transaction, "delete" | "select">,
  now: Date,
  limit: number = CHAT_RETENTION_PRUNE_BATCH,
): Promise<number> {
  const expired = executor
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(lt(chatMessages.createdAt, new Date(chatRetentionCutoff(now.getTime()))))
    .orderBy(chatMessages.seq)
    .limit(limit)
    .for("update", { skipLocked: true });
  const deleted = await executor
    .delete(chatMessages)
    .where(inArray(chatMessages.id, expired))
    .returning({ id: chatMessages.id });
  return deleted.length;
}

/**
 * One page of a channel's feed for the viewer: the latest page, or with
 * `before` the page strictly older than that message. Oldest first. Expired
 * rows never render even before a send prunes them. Every viewer pages the
 * same rows; one from an account the viewer blocked arrives redacted (#261),
 * its content never read into the response.
 */
export async function readChatHistory(
  userId: string,
  characterId: string,
  request: { channel: ChatChannel; before?: number },
  now: Date = new Date(),
): Promise<ChatHistoryPage> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  const accountId = character.playerAccountId;
  const rows = await db
    .select({
      message: chatMessages,
      redacted: blockedByViewer(accountId, chatMessages.senderPlayerAccountId),
    })
    .from(chatMessages)
    .where(
      and(
        channelFeed(request.channel),
        gte(chatMessages.createdAt, new Date(chatRetentionCutoff(now.getTime()))),
        request.before === undefined ? undefined : lt(chatMessages.seq, request.before),
      ),
    )
    .orderBy(desc(chatMessages.seq))
    .limit(CHAT_POLICY.pageSize + 1);
  const page = rows.slice(0, CHAT_POLICY.pageSize);
  const [sends, lastAd, mentions] = await Promise.all([
    recentSendTimes(db, accountId, now),
    lastPromotedAt(db, accountId, now),
    mentionsOf(
      db,
      page.filter((row) => !row.redacted).map((row) => row.message.id),
    ),
  ]);
  return {
    channel: request.channel,
    messages: page
      .reverse()
      .map(({ message, redacted }) =>
        redacted ? redact(toView(message, [])) : toView(message, mentions.get(message.id) ?? []),
      ),
    hasOlder: rows.length > CHAT_POLICY.pageSize,
    budget: budgetFrom(sends, now),
    promotedAd: adStatus(lastAd, now),
  };
}

export type ChatSendCheck =
  | { ok: true; body: string; sends: number[] }
  | {
      ok: false;
      reason: "socially_restricted" | "empty" | "too_long" | "prohibited_term" | "rate_limited";
      error: string;
      sends: number[];
    };

/**
 * The shared first half of every chat send — General, Trade, promoted ads, and
 * Whispers (#247) — inside the caller's transaction: take the account's send
 * lock (so every tab, device, and character is serialized onto one budget),
 * prune a bounded batch of expired rows, then check the account's social
 * restriction (#248), content, the severe-term guardrail, and the shared
 * rolling budget for `channel`. Issuing a sanction takes the same lock, so a
 * send in flight either commits before the restriction or is refused by it.
 * A refusal here is
 * never persisted or delivered and records nothing about the sender. The
 * caller persists the send in the same transaction, so it counts at once.
 */
export async function beginChatSend(
  tx: Transaction,
  accountId: string,
  channel: ChatSendChannel,
  text: string,
  { now = new Date(), denylist }: ChatSendOptions,
): Promise<ChatSendCheck> {
  await lockAccountChatSends(tx, accountId);
  await pruneExpiredChatMessages(tx, now);
  const sends = await recentSendTimes(tx, accountId, now);

  // A socially restricted account sends nothing, on any character (#248).
  if (await isSociallyRestricted(tx, accountId, now)) {
    return {
      ok: false,
      reason: "socially_restricted",
      error: REFUSAL_COPY.socially_restricted,
      sends,
    };
  }

  // Content next.
  const content = normalizeChatMessage(text);
  if (!content.ok) {
    return { ok: false, reason: content.reason, error: REFUSAL_COPY[content.reason], sends };
  }
  if (containsSevereTerm(content.body, denylist)) {
    return { ok: false, reason: "prohibited_term", error: REFUSAL_COPY.prohibited_term, sends };
  }

  const decision = decideChatSend(channel, sends, now.getTime());
  if (!decision.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      error: `Slow down. You can send again in ${secondsLabel(decision.retryAfterMs)}.`,
      sends,
    };
  }
  return { ok: true, body: content.body, sends };
}

/**
 * Resolve the characters a public message mentions (#261), inside the send's
 * transaction. Each target is what the composer's selection named — a stable
 * id, or a Nearby Player's exact name at the sender's location — and must be
 * another account's character whose current name the body shows after `@`.
 * The body is checked against every resolved name at once, so a longer
 * name's `@Name` never counts for a shorter one. Anything else refuses the
 * whole send, so a mention is never silently dropped or guessed. A target the
 * sender blocked is refused like a Whisper would be; a target who blocked the
 * sender is accepted, stored already read, and never alerted, so the Block is
 * not disclosed and Unblocking never brings it back as attention.
 */
async function resolveMentions(
  tx: Transaction,
  sender: Character,
  body: string,
  targets: readonly CharacterTarget[],
): Promise<
  | { ok: true; mentioned: { character: Character; silenced: boolean }[] }
  | { ok: false; reason: "invalid_mention" | "blocked_by_you"; error: string }
> {
  if (targets.length > CHAT_POLICY.maxMentions) {
    return { ok: false, reason: "invalid_mention", error: MENTION_TOO_MANY };
  }
  const resolved = new Map<string, Character>();
  for (const target of targets) {
    const character = await resolveCharacterTarget(target, sender, { executor: tx });
    if (!character) return { ok: false, reason: "invalid_mention", error: MENTION_UNMATCHED };
    resolved.set(character.id, character);
  }
  const shown = namesShownAsMentions(
    body,
    [...resolved.values()].map((character) => character.displayName),
  );
  const mentioned: { character: Character; silenced: boolean }[] = [];
  for (const character of resolved.values()) {
    if (!shown.has(character.displayName)) {
      return { ok: false, reason: "invalid_mention", error: MENTION_UNMATCHED };
    }
    if (character.playerAccountId === sender.playerAccountId) {
      return { ok: false, reason: "invalid_mention", error: MENTION_OWN };
    }
    const block = await blockBetween(sender.playerAccountId, character.playerAccountId, tx);
    if (block.iBlockedThem) {
      return {
        ok: false,
        reason: "blocked_by_you",
        error: `You blocked ${character.displayName}. Unblock them to mention them.`,
      };
    }
    mentioned.push({ character, silenced: block.theyBlockedMe });
  }
  return { ok: true, mentioned };
}

type SendKind =
  | { channel: "general" | "trade"; promoted: false }
  | { channel: "trade"; promoted: true };

async function commitSend(
  userId: string,
  characterId: string,
  kind: SendKind,
  text: string,
  mentions: readonly CharacterTarget[],
  { now = new Date(), denylist }: ChatSendOptions,
): Promise<ChatSendResult> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  const accountId = character.playerAccountId;

  let mentioned: Character[] = [];
  const result = await db.transaction(async (tx): Promise<ChatSendResult> => {
    const begun = await beginChatSend(tx, accountId, kind.channel, text, { now, denylist });
    const sends = begun.sends;
    const lastAd = await lastPromotedAt(tx, accountId, now);
    const refuse = (reason: ChatSendRefusalReason, error: string): ChatSendResult => ({
      status: "refused",
      reason,
      error,
      budget: budgetFrom(sends, now),
      promotedAd: adStatus(lastAd, now),
    });
    if (!begun.ok) return refuse(begun.reason, begun.error);
    const resolved = await resolveMentions(tx, character, begun.body, mentions);
    if (!resolved.ok) return refuse(resolved.reason, resolved.error);

    let promotedPriceCredits: number | null = null;
    if (kind.promoted) {
      const readyInMs = promotedAdCooldownRemaining(lastAd, now.getTime());
      if (readyInMs > 0) {
        return refuse(
          "ad_cooldown",
          `You can post another promoted ad in ${minutesLabel(readyInMs)}.`,
        );
      }
      // The ad spends Credits, so a trade-engaged character may not post one
      // (#266). Lock the row first so acceptance cannot claim it in between.
      await tx
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, character.id))
        .for("no key update");
      await assertNotTradeEngaged(tx, character.id, now);
      promotedPriceCredits = CHAT_POLICY.promotedAd.priceCredits;
      const charged = await tx
        .update(characters)
        .set({ credits: sql`${characters.credits} - ${promotedPriceCredits}` })
        .where(
          and(
            eq(characters.id, character.id),
            eq(characters.playerAccountId, accountId),
            gte(characters.credits, promotedPriceCredits),
          ),
        )
        .returning({ id: characters.id });
      if (charged.length === 0) {
        return refuse("insufficient_credits", REFUSAL_COPY.insufficient_credits);
      }
    }

    const [row] = await tx
      .insert(chatMessages)
      .values({
        channel: kind.channel,
        senderPlayerAccountId: accountId,
        senderCharacterId: character.id,
        senderCharacterName: character.displayName,
        body: begun.body,
        promotedPriceCredits,
        createdAt: now,
      })
      .returning();
    // The mentions commit with their message, or neither does.
    if (resolved.mentioned.length > 0) {
      await tx.insert(chatMessageMentions).values(
        resolved.mentioned.map(({ character: target, silenced }) => ({
          messageId: row!.id,
          mentionedCharacterId: target.id,
          mentionedPlayerAccountId: target.playerAccountId,
          mentionedCharacterName: target.displayName,
          // A mention of someone who blocked the sender is never attention.
          readAt: silenced ? now : null,
        })),
      );
    }
    mentioned = resolved.mentioned
      .filter((target) => !target.silenced)
      .map((target) => target.character);
    const sentAt = now.getTime();
    return {
      status: "sent",
      message: toView(
        row!,
        resolved.mentioned
          .map(({ character: target }) => ({ characterId: target.id, name: target.displayName }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      ),
      budget: budgetFrom([...sends, sentAt], now),
      promotedAd: adStatus(kind.promoted ? sentAt : lastAd, now),
    };
  });

  if (result.status === "sent") await publishChatMessage(result.message, accountId, mentioned);
  return result;
}

/**
 * The live-delivery half of the viewer seam (`blockedByViewer` is the read
 * half). Called only after the message committed: every open tab receives it,
 * except that each account blocking the sender (#247) receives only its
 * redacted form (#261) — decided server-side, because the payload carries no
 * account identity a browser could filter on, and a blocker's browser must
 * never hold the content. A promoted ad is one delivery of one record that
 * each feed places. Each mentioned character with no Block either way is
 * prompted to re-read its mention attention. Best-effort: the message is
 * already durable, so a failure here only leaves open tabs to catch up on
 * their next reconcile read.
 */
async function publishChatMessage(
  message: VisibleChatMessageView,
  senderAccountId: string,
  mentioned: readonly Pick<Character, "id" | "playerAccountId">[],
) {
  try {
    const blockers = new Set(await accountsBlocking(senderAccountId));
    publishRealtimeEvent({ kind: "everyone", exceptAccountIds: blockers }, "chat.message", message);
    if (blockers.size > 0) {
      const redacted = redact(message);
      for (const playerAccountId of blockers) {
        publishRealtimeEvent({ kind: "account", playerAccountId }, "chat.message", redacted);
      }
    }
    for (const target of mentioned) {
      if (blockers.has(target.playerAccountId)) continue;
      publishRealtimeEvent({ kind: "character", characterId: target.id }, "chat.mention", {});
    }
  } catch {
    // Delivery is a prompt, never the ledger; reconcile reads recover it.
  }
}

/** Send one ordinary General or Trade message as the active character. */
export async function sendChatMessage(
  userId: string,
  characterId: string,
  request: { channel: ChatChannel; text: string; mentions?: readonly CharacterTarget[] },
  options: ChatSendOptions = {},
): Promise<ChatSendResult> {
  return commitSend(
    userId,
    characterId,
    { channel: request.channel, promoted: false },
    request.text,
    request.mentions ?? [],
    options,
  );
}

/**
 * Post one promoted Trade ad: the active character pays the ad price, the
 * account's ad cooldown and ordinary send budget both apply, and the one
 * record is shown in both General and Trade.
 */
export async function postPromotedTradeAd(
  userId: string,
  characterId: string,
  request: { text: string; mentions?: readonly CharacterTarget[] },
  options: ChatSendOptions = {},
): Promise<ChatSendResult> {
  return commitSend(
    userId,
    characterId,
    { channel: "trade", promoted: true },
    request.text,
    request.mentions ?? [],
    options,
  );
}

/**
 * The active character's unread `@mentions` (#261): mentions it has not read
 * on messages still inside retention, never one whose sender and target
 * accounts have a Block between them in either direction — so a blocked
 * player can never reach the blocker through mention attention, and a Block
 * placed later silences mentions already sent. Derived from durable rows, so
 * every tab, device, and reconnect reads the same count.
 */
export async function readChatMentions(
  userId: string,
  characterId: string,
  now: Date = new Date(),
): Promise<ChatMentionsView> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const [row] = await db
    .select({
      total: count(),
      general: sql<number>`count(*) filter (where ${channelFeed("general")})`.mapWith(Number),
      trade: sql<number>`count(*) filter (where ${channelFeed("trade")})`.mapWith(Number),
    })
    .from(chatMessageMentions)
    .innerJoin(chatMessages, eq(chatMessages.id, chatMessageMentions.messageId))
    .where(
      and(
        eq(chatMessageMentions.mentionedCharacterId, me.id),
        isNull(chatMessageMentions.readAt),
        gte(chatMessages.createdAt, new Date(chatRetentionCutoff(now.getTime()))),
        not(
          blockedEitherWay(
            chatMessageMentions.mentionedPlayerAccountId,
            chatMessages.senderPlayerAccountId,
          ),
        ),
      ),
    );
  return {
    unread: { general: row?.general ?? 0, trade: row?.trade ?? 0 },
    unreadTotal: row?.total ?? 0,
  };
}

/**
 * Mark the active character's mentions read through `throughSeq` in one
 * channel's feed — what that tab has shown. A promoted ad shows in both feeds,
 * so reading either clears it. Read once, read everywhere: the character's
 * other tabs are told to re-read. A mention newer than what was shown stays
 * unread.
 */
export async function markChatMentionsRead(
  userId: string,
  characterId: string,
  request: { channel: ChatChannel; throughSeq: number },
  now: Date = new Date(),
): Promise<{ status: "read" }> {
  const me = await requirePlayableOwnedCharacter(userId, characterId);
  const shown = db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(channelFeed(request.channel), lte(chatMessages.seq, request.throughSeq)));
  const marked = await db
    .update(chatMessageMentions)
    .set({ readAt: now })
    .where(
      and(
        eq(chatMessageMentions.mentionedCharacterId, me.id),
        isNull(chatMessageMentions.readAt),
        inArray(chatMessageMentions.messageId, shown),
      ),
    )
    .returning({ messageId: chatMessageMentions.messageId });
  if (marked.length > 0) {
    publishRealtimeEvent({ kind: "character", characterId: me.id }, "chat.mentions.read", {});
  }
  return { status: "read" };
}
