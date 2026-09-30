import {
  CHAT_POLICY,
  chatSendPressure,
  type ChatChannel,
  type ChatSendChannel,
} from "@/game/domain/chat";
import type { ChatMessageView, ChatSendBudget, PromotedAdStatus } from "@/game/schemas/chat";

/**
 * Browser-side chat state (issue #246; Whisper conversations #247).
 * Framework-free so it is unit-testable; `PublicChat` and `WhisperPanel` own
 * the React wiring.
 *
 * A feed is a projection of durable messages keyed by message id and ordered
 * by `seq`. Every source — the latest page, an older page, a realtime delivery,
 * a reconnect re-read — merges by id, so the same message arriving twice
 * (several tabs, a delivery racing a read) is still rendered once.
 */

/** Anything a feed can hold: a public message or a Whisper. */
type Sequenced = { id: string; seq: number };

/** The page shape both public history and Whisper history return. */
type FeedPage<Message extends Sequenced> = { messages: readonly Message[]; hasOlder: boolean };

export type Feed<Message extends Sequenced> = {
  /** Oldest first, unique by id. */
  messages: readonly Message[];
  hasOlder: boolean;
  loaded: boolean;
  /**
   * The newest `seq` a history page has confirmed. Live deliveries never move
   * it, so a delivery that races a reconnect read cannot hide a gap.
   */
  syncedThrough?: number;
};

export type ChatFeed = Feed<ChatMessageView>;

export const EMPTY_FEED: Feed<never> = { messages: [], hasOlder: false, loaded: false };
export const EMPTY_CHAT_FEED: ChatFeed = EMPTY_FEED;

/** Whether a message belongs in a channel's feed: an ad shows in both. */
export function feedIncludes(channel: ChatChannel, message: ChatMessageView): boolean {
  return message.channel === channel || (channel === "general" && message.promoted);
}

function merge<Message extends Sequenced>(
  current: readonly Message[],
  incoming: readonly Message[],
): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Apply a latest-page read (first open, reconnect, or tab resume). When the
 * page does not reach back to what history last confirmed and more history
 * exists, messages in between were missed; the feed restarts from the page
 * (keeping only live messages from its span on) rather than render a silent
 * gap, and older ones load on request.
 */
export function applyLatestPage<Message extends Sequenced>(
  feed: Feed<Message>,
  page: FeedPage<Message>,
): Feed<Message> {
  const oldestInPage = page.messages[0]?.seq;
  const newestInPage = page.messages.at(-1)?.seq;
  const syncedThrough = Math.max(feed.syncedThrough ?? 0, newestInPage ?? 0) || undefined;
  if (
    feed.syncedThrough !== undefined &&
    oldestInPage !== undefined &&
    page.hasOlder &&
    oldestInPage > feed.syncedThrough
  ) {
    // Held messages older than the page sit behind the gap; drop them. Live
    // ones inside or after the page's span are contiguous with it.
    const contiguous = feed.messages.filter((message) => message.seq >= oldestInPage);
    return {
      messages: merge(contiguous, page.messages),
      hasOlder: page.hasOlder,
      loaded: true,
      syncedThrough,
    };
  }
  return {
    messages: merge(feed.messages, page.messages),
    // Only the first read says whether older history exists; after that,
    // load-older pages own it.
    hasOlder: feed.loaded ? feed.hasOlder : page.hasOlder,
    loaded: true,
    syncedThrough,
  };
}

/** Apply a load-older page. */
export function applyOlderPage<Message extends Sequenced>(
  feed: Feed<Message>,
  page: FeedPage<Message>,
): Feed<Message> {
  return { ...feed, messages: merge(feed.messages, page.messages), hasOlder: page.hasOlder };
}

/**
 * Apply one message from a send result or a realtime delivery. Kept even
 * before the first read lands: that read may have been taken before the
 * message committed.
 */
export function applyMessage(
  feed: ChatFeed,
  channel: ChatChannel,
  message: ChatMessageView,
): ChatFeed {
  if (!feedIncludes(channel, message)) return feed;
  return insertMessage(feed, message);
}

/**
 * Add one message to a feed it belongs in: a send result, a delivery, or a
 * Whisper in its conversation.
 */
export function insertMessage<Message extends Sequenced>(
  feed: Feed<Message>,
  message: Message,
): Feed<Message> {
  if (feed.messages.some((existing) => existing.id === message.id)) return feed;
  return { ...feed, messages: merge(feed.messages, [message]) };
}

/**
 * The account's send budget in this tab's clock: when each recent successful
 * send leaves the rolling window. Replaced wholesale by every authoritative
 * response, so another tab's or device's sends correct it.
 */
export type LocalChatBudget = { expiresAt: readonly number[] };

export function localBudget(budget: ChatSendBudget, receivedAt: number): LocalChatBudget {
  return {
    expiresAt: budget.recentSendExpiresInMs
      .filter((ms) => ms > 0)
      .map((ms) => receivedAt + ms)
      .sort((a, b) => a - b),
  };
}

export type ComposerPressure = {
  count: number;
  limit: number;
  pressure: ReturnType<typeof chatSendPressure>;
  /** When the next recent send ages out, if any; drives the local countdown. */
  nextChangeAt?: number;
  /** When red: when sending to this channel becomes possible again. */
  readyAt?: number;
};

/** The composer indicator for a channel at `now`, from the local budget. */
export function composerPressure(
  budget: LocalChatBudget,
  channel: ChatSendChannel,
  now: number,
): ComposerPressure {
  const live = budget.expiresAt.filter((at) => at > now);
  const limit = CHAT_POLICY.sendLimit[channel];
  const pressure = chatSendPressure(channel, live.length);
  return {
    count: live.length,
    limit,
    pressure,
    nextChangeAt: live[0],
    // Sending opens once all but limit - 1 recent sends have aged out.
    readyAt: pressure === "full" ? live[live.length - limit] : undefined,
  };
}

/** When the account may post its next promoted ad, in this tab's clock. */
export function localAdReadyAt(status: PromotedAdStatus, receivedAt: number): number {
  return receivedAt + status.readyInMs;
}

/** Whole seconds left until `at`, never below 1 while it is still ahead. */
export function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}
