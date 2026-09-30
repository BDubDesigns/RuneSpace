import { CHAT_POLICY, chatSendPressure, type ChatChannel } from "@/game/domain/chat";
import type {
  ChatHistoryPage,
  ChatMessageView,
  ChatSendBudget,
  PromotedAdStatus,
} from "@/game/schemas/chat";

/**
 * Browser-side public chat state (issue #246). Framework-free so it is
 * unit-testable; `PublicChat` owns the React wiring.
 *
 * A feed is a projection of durable messages keyed by message id and ordered
 * by `seq`. Every source — the latest page, an older page, a realtime delivery,
 * a reconnect re-read — merges by id, so the same message arriving twice
 * (several tabs, a delivery racing a read) is still rendered once.
 */

export type ChatFeed = {
  /** Oldest first, unique by id. */
  messages: readonly ChatMessageView[];
  hasOlder: boolean;
  loaded: boolean;
  /**
   * The newest `seq` a history page has confirmed. Live deliveries never move
   * it, so a delivery that races a reconnect read cannot hide a gap.
   */
  syncedThrough?: number;
};

export const EMPTY_CHAT_FEED: ChatFeed = { messages: [], hasOlder: false, loaded: false };

/** Whether a message belongs in a channel's feed: an ad shows in both. */
export function feedIncludes(channel: ChatChannel, message: ChatMessageView): boolean {
  return message.channel === channel || (channel === "general" && message.promoted);
}

function merge(
  current: readonly ChatMessageView[],
  incoming: readonly ChatMessageView[],
): ChatMessageView[] {
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
export function applyLatestPage(feed: ChatFeed, page: ChatHistoryPage): ChatFeed {
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
export function applyOlderPage(feed: ChatFeed, page: ChatHistoryPage): ChatFeed {
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
  channel: ChatChannel,
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
