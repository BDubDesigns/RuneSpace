import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  max,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { characters, chatMessages, type ChatMessage } from "@/db/rune-space";
import {
  CHAT_POLICY,
  chatRetentionCutoff,
  decideChatSend,
  normalizeChatMessage,
  promotedAdCooldownRemaining,
  recentChatSends,
  type ChatChannel,
  type ChatSendChannel,
} from "@/game/domain/chat";
import type {
  ChatHistoryPage,
  ChatMessageView,
  ChatSendBudget,
  ChatSendRefusalReason,
  ChatSendResult,
  PromotedAdStatus,
} from "@/game/schemas/chat";
import { containsSevereTerm } from "@/server/chat-guardrail";
import { lockAccountChatSends } from "@/server/chat-send-lock";
import { requirePlayableOwnedCharacter } from "@/server/gameplay-access";
import { isSociallyRestricted, SOCIALLY_RESTRICTED_MESSAGE } from "@/server/moderation-sanctions";
import { accountsBlocking, notBlockedByViewer } from "@/server/player-blocks";
import { publishRealtimeEvent } from "@/server/realtime";

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
 */

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<Transaction, "select" | "execute">;

/**
 * At most this many expired rows are deleted per send, so retention never
 * makes one send slow; any backlog clears over the following sends.
 */
export const CHAT_RETENTION_PRUNE_BATCH = 500;

/** Who is reading. Public feeds are projected per viewer, never globally. */
export type ChatViewer = { playerAccountId: string; characterId: string };

export type ChatSendOptions = {
  now?: Date;
  /** The severe-term list; tests inject their own. */
  denylist?: ReadonlySet<string>;
};

/**
 * The per-viewer visibility seam for public chat reads: a viewer never sees
 * messages from an account they blocked (#247). Applied in SQL so pages stay
 * full and cursors stay exact.
 */
function visibleToViewer(viewer: ChatViewer): SQL {
  return notBlockedByViewer(viewer.playerAccountId, chatMessages.senderPlayerAccountId);
}

/**
 * Which rows a channel's feed shows: its own, and in General every ad. Report
 * context (#247) reads the same feed the reporter saw.
 */
export function channelFeed(channel: ChatChannel): SQL {
  return channel === "general"
    ? or(eq(chatMessages.channel, "general"), isNotNull(chatMessages.promotedPriceCredits))!
    : eq(chatMessages.channel, "trade");
}

function toView(row: ChatMessage): ChatMessageView {
  return {
    id: row.id,
    seq: row.seq,
    channel: row.channel as ChatChannel,
    senderCharacterId: row.senderCharacterId,
    senderName: row.senderCharacterName,
    body: row.body,
    sentAt: row.createdAt.toISOString(),
    promoted: row.promotedPriceCredits !== null,
  };
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
  Exclude<ChatSendRefusalReason, "rate_limited" | "ad_cooldown">,
  string
> = {
  socially_restricted: SOCIALLY_RESTRICTED_MESSAGE,
  empty: "Type a message first.",
  too_long: `Messages can be up to ${CHAT_POLICY.maxLength} characters.`,
  prohibited_term: "That message wasn't sent: it contains a slur RuneSpace blocks.",
  insufficient_credits: `A promoted ad costs ${CHAT_POLICY.promotedAd.priceCredits} Credits.`,
};

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
 * rows never render even before a send prunes them.
 */
export async function readChatHistory(
  userId: string,
  characterId: string,
  request: { channel: ChatChannel; before?: number },
  now: Date = new Date(),
): Promise<ChatHistoryPage> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  const viewer = { playerAccountId: character.playerAccountId, characterId: character.id };
  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        channelFeed(request.channel),
        gte(chatMessages.createdAt, new Date(chatRetentionCutoff(now.getTime()))),
        request.before === undefined ? undefined : lt(chatMessages.seq, request.before),
        visibleToViewer(viewer),
      ),
    )
    .orderBy(desc(chatMessages.seq))
    .limit(CHAT_POLICY.pageSize + 1);
  const page = rows.slice(0, CHAT_POLICY.pageSize);
  const [sends, lastAd] = await Promise.all([
    recentSendTimes(db, viewer.playerAccountId, now),
    lastPromotedAt(db, viewer.playerAccountId, now),
  ]);
  return {
    channel: request.channel,
    messages: page.reverse().map(toView),
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

type SendKind =
  | { channel: "general" | "trade"; promoted: false }
  | { channel: "trade"; promoted: true };

async function commitSend(
  userId: string,
  characterId: string,
  kind: SendKind,
  text: string,
  { now = new Date(), denylist }: ChatSendOptions,
): Promise<ChatSendResult> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  const accountId = character.playerAccountId;

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

    let promotedPriceCredits: number | null = null;
    if (kind.promoted) {
      const readyInMs = promotedAdCooldownRemaining(lastAd, now.getTime());
      if (readyInMs > 0) {
        return refuse(
          "ad_cooldown",
          `You can post another promoted ad in ${minutesLabel(readyInMs)}.`,
        );
      }
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
    const sentAt = now.getTime();
    return {
      status: "sent",
      message: toView(row!),
      budget: budgetFrom([...sends, sentAt], now),
      promotedAd: adStatus(kind.promoted ? sentAt : lastAd, now),
    };
  });

  if (result.status === "sent") await publishChatMessage(result.message, accountId);
  return result;
}

/**
 * The live-delivery half of the viewer seam (`visibleToViewer` is the read
 * half). Called only after the message committed: it prompts every open tab
 * except those of accounts that blocked the sender (#247) — server-side,
 * because the payload deliberately carries no account identity a browser
 * could filter on. A promoted ad is one delivery of one record that each feed
 * places. Best-effort: the message is already durable, so a failure here only
 * leaves open tabs to catch up on their next reconcile read.
 */
async function publishChatMessage(message: ChatMessageView, senderAccountId: string) {
  try {
    const blockers = await accountsBlocking(senderAccountId);
    publishRealtimeEvent(
      { kind: "everyone", exceptAccountIds: new Set(blockers) },
      "chat.message",
      message,
    );
  } catch {
    // Delivery is a prompt, never the ledger; reconcile reads recover it.
  }
}

/** Send one ordinary General or Trade message as the active character. */
export async function sendChatMessage(
  userId: string,
  characterId: string,
  request: { channel: ChatChannel; text: string },
  options: ChatSendOptions = {},
): Promise<ChatSendResult> {
  return commitSend(
    userId,
    characterId,
    { channel: request.channel, promoted: false },
    request.text,
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
  request: { text: string },
  options: ChatSendOptions = {},
): Promise<ChatSendResult> {
  return commitSend(
    userId,
    characterId,
    { channel: "trade", promoted: true },
    request.text,
    options,
  );
}
