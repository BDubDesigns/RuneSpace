"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { CHAT_POLICY, chatMessageLength, type ChatChannel } from "@/game/domain/chat";
import { GAMEPLAY_ACCESS_REQUIRED_CODE } from "@/game/domain/gameplay-access";
import {
  ChatMessageViewSchema,
  type ChatHistoryPage,
  type ChatMessageView,
  type ChatSendResult,
} from "@/game/schemas/chat";
import { usePlay } from "@/features/play/PlayContext";
import { useSocial } from "@/features/social/SocialContext";
import { postPromotedTradeAdAction, sendChatMessageAction } from "@/server/actions";
import {
  applyLatestPage,
  applyMessage,
  applyOlderPage,
  composerPressure,
  EMPTY_CHAT_FEED,
  localAdReadyAt,
  localBudget,
  secondsUntil,
  type ChatFeed,
  type LocalChatBudget,
} from "./chat-feed";

/**
 * General and Trade (issue #246), rendered inside the Chat/Social surface.
 *
 * Every message shown is durable: the latest page loads on open, older pages
 * on request, and after each stream (re)connect or tab resume the latest page
 * is re-read. Realtime deliveries only add messages sooner; all of it merges by
 * message id, so nothing renders twice. Sends are ordinary server actions whose
 * responses carry the account's authoritative send budget and ad cooldown,
 * which this tab then counts down locally without polling.
 */

const CHANNEL_LABEL: Record<ChatChannel, string> = { general: "General", trade: "Trade" };

type Feeds = Record<ChatChannel, ChatFeed>;

async function fetchPage(
  characterId: string,
  channel: ChatChannel,
  before?: number,
): Promise<{ page: ChatHistoryPage } | { error: string; code?: string }> {
  const params = new URLSearchParams({ characterId, channel });
  if (before !== undefined) params.set("before", String(before));
  try {
    const response = await fetch(`/api/chat?${params}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | (ChatHistoryPage & { error?: undefined })
      | { error?: string; code?: string }
      | null;
    if (!response.ok || !body || "error" in body) {
      const refusal = body as { error?: string; code?: string } | null;
      return { error: refusal?.error ?? "Chat could not be loaded.", code: refusal?.code };
    }
    return { page: body as ChatHistoryPage };
  } catch {
    return { error: "Chat could not be loaded." };
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

export function PublicChat({ characterId }: { characterId: string }) {
  const router = useRouter();
  const { subscribe, onReconcile } = useSocial();
  const { requestAutoRefresh, state } = usePlay();
  const [channel, setChannel] = useState<ChatChannel>("general");
  const [feeds, setFeeds] = useState<Feeds>({ general: EMPTY_CHAT_FEED, trade: EMPTY_CHAT_FEED });
  const [loadError, setLoadError] = useState<string>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [budget, setBudget] = useState<LocalChatBudget>({ expiresAt: [] });
  const [adReadyAt, setAdReadyAt] = useState(0);
  const [adPrice, setAdPrice] = useState<number>(CHAT_POLICY.promotedAd.priceCredits);
  const [draft, setDraft] = useState("");
  const [promote, setPromote] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "danger" | "success"; text: string }>();
  const [now, setNow] = useState(() => Date.now());
  const feedsRef = useRef(feeds);
  feedsRef.current = feeds;
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const olderAnchor = useRef<{ height: number; top: number } | undefined>(undefined);

  const channelRef = useRef(channel);
  channelRef.current = channel;
  // Account state answers arrive out of order (a reconnect read racing a
  // send); only an answer to a request issued after the last one applied may
  // replace it.
  const requestCounter = useRef(0);
  const appliedRequest = useRef(0);

  const absorbAccount = useCallback(
    (result: Pick<ChatHistoryPage, "budget" | "promotedAd">, request: number) => {
      if (request < appliedRequest.current) return;
      appliedRequest.current = request;
      const receivedAt = Date.now();
      setBudget(localBudget(result.budget, receivedAt));
      setAdReadyAt(localAdReadyAt(result.promotedAd, receivedAt));
      setAdPrice(result.promotedAd.priceCredits);
      setNow(receivedAt);
    },
    [],
  );

  const loadLatest = useCallback(
    async (target: ChatChannel) => {
      const request = ++requestCounter.current;
      const result = await fetchPage(characterId, target);
      if ("error" in result) {
        // Issue #223: access closed since this page loaded; recover like
        // every other gameplay read.
        if (result.code === GAMEPLAY_ACCESS_REQUIRED_CODE) router.replace("/characters");
        else setLoadError(result.error);
        return;
      }
      setLoadError(undefined);
      absorbAccount(result.page, request);
      setFeeds((current) => ({
        ...current,
        [target]: applyLatestPage(current[target], result.page),
      }));
    },
    [absorbAccount, characterId, router],
  );

  // First read of whichever feed is showing; the other loads when chosen.
  useEffect(() => {
    if (!feedsRef.current[channel].loaded) void loadLatest(channel);
  }, [channel, loadLatest]);

  // Reconnect and tab resume: re-read every feed this tab has open.
  useEffect(
    () =>
      onReconcile(() => {
        for (const target of ["general", "trade"] as const) {
          if (feedsRef.current[target].loaded) void loadLatest(target);
        }
      }),
    [loadLatest, onReconcile],
  );

  // Live deliveries: one promoted ad lands in both feeds from one record.
  useEffect(
    () =>
      subscribe("chat.message", (data) => {
        const parsed = ChatMessageViewSchema.safeParse(data);
        if (!parsed.success) return;
        const message = parsed.data;
        setFeeds((current) => ({
          general: applyMessage(current.general, "general", message),
          trade: applyMessage(current.trade, "trade", message),
        }));
      }),
    [subscribe],
  );

  // A local, network-free clock for the countdowns while anything is ticking.
  const ticking = budget.expiresAt.some((at) => at > now) || adReadyAt > now;
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);

  const feed = feeds[channel];

  // Keep the newest message in view unless the player scrolled up to read;
  // when older history is prepended, hold the reading position still.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const anchor = olderAnchor.current;
    if (anchor) {
      log.scrollTop = anchor.top + (log.scrollHeight - anchor.height);
      olderAnchor.current = undefined;
    } else if (stickToBottom.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [feed.messages]);

  useLayoutEffect(() => {
    stickToBottom.current = true;
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [channel]);

  async function loadOlder() {
    const oldest = feed.messages[0];
    if (!oldest || loadingOlder) return;
    const target = channel;
    setLoadingOlder(true);
    const request = ++requestCounter.current;
    const result = await fetchPage(characterId, target, oldest.seq);
    setLoadingOlder(false);
    if ("error" in result) {
      if (result.code === GAMEPLAY_ACCESS_REQUIRED_CODE) router.replace("/characters");
      else setLoadError(result.error);
      return;
    }
    const log = logRef.current;
    // The player may have switched tabs while this page loaded.
    if (log && target === channelRef.current) {
      olderAnchor.current = { height: log.scrollHeight, top: log.scrollTop };
    }
    absorbAccount(result.page, request);
    setFeeds((current) => ({ ...current, [target]: applyOlderPage(current[target], result.page) }));
  }

  const trimmedLength = chatMessageLength(draft.trim());
  const overLimit = trimmedLength > CHAT_POLICY.maxLength;
  const pressure = composerPressure(budget, channel, now);
  const rateBlocked = pressure.pressure === "full";
  const promoting = channel === "trade" && promote;
  const adWaitMs = Math.max(0, adReadyAt - now);
  const credits = state.credits;
  const canAfford = credits >= adPrice;
  const canSend = trimmedLength > 0 && !overLimit && !rateBlocked && !sending;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend || (promoting && (adWaitMs > 0 || !canAfford))) return;
    const request = ++requestCounter.current;
    setSending(true);
    setFeedback(undefined);
    let result: ChatSendResult | { error: string };
    try {
      result = promoting
        ? await postPromotedTradeAdAction({ characterId, text: draft })
        : await sendChatMessageAction({ characterId, channel, text: draft });
    } catch {
      result = { error: "Message not sent. Check your connection and try again." };
    }
    setSending(false);
    // An action-level failure (bad input, lost session) has no status.
    if (!("status" in result)) {
      setFeedback({ tone: "danger", text: result.error });
      return;
    }
    absorbAccount(result, request);
    if (result.status === "refused") {
      setFeedback({ tone: "danger", text: result.error });
      return;
    }
    const message: ChatMessageView = result.message;
    stickToBottom.current = true;
    setFeeds((current) => ({
      general: applyMessage(current.general, "general", message),
      trade: applyMessage(current.trade, "trade", message),
    }));
    setDraft("");
    if (message.promoted) {
      setPromote(false);
      setFeedback({ tone: "success", text: "Promoted ad posted to General and Trade." });
      // The Credits were spent server-side; let Play re-read its balance.
      requestAutoRefresh();
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  const label = CHANNEL_LABEL[channel];
  const composerId = "public-chat-composer";
  const pressureId = "public-chat-pressure";
  const counterId = "public-chat-counter";

  return (
    <div className="space-y-3" data-public-chat="">
      <div
        aria-label="Public chat channels"
        className="grid grid-cols-2 gap-1 border-b border-[color:var(--rs-border-structural)] pb-1"
        role="tablist"
      >
        {(["general", "trade"] as const).map((option) => {
          const selected = option === channel;
          return (
            <button
              aria-controls="public-chat-panel"
              aria-selected={selected}
              className={`rs-focus min-h-[var(--rs-touch-target)] border px-3 py-2 font-display text-xs uppercase tracking-[0.12em] outline-none ${selected ? "border-[color:var(--rs-accent-primary)] text-[color:var(--rs-accent-primary)]" : "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-secondary)]"}`}
              data-chat-channel-tab={option}
              id={`public-chat-tab-${option}`}
              key={option}
              onClick={() => {
                setChannel(option);
                setFeedback(undefined);
              }}
              role="tab"
              type="button"
            >
              {CHANNEL_LABEL[option]}
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={`public-chat-tab-${channel}`}
        className="space-y-3"
        id="public-chat-panel"
        role="tabpanel"
      >
        <div
          aria-label={`${label} messages`}
          className="h-[min(38dvh,22rem)] overflow-y-auto overscroll-contain border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-2"
          data-chat-log={channel}
          onScroll={(event) => {
            const log = event.currentTarget;
            stickToBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
          }}
          ref={logRef}
          role="log"
          tabIndex={0}
        >
          {feed.hasOlder ? (
            <div className="mb-2 flex justify-center">
              <ActionButton
                className="min-h-9 px-3 py-1 text-xs"
                intent="secondary"
                loading={loadingOlder}
                onClick={() => void loadOlder()}
              >
                Load older messages
              </ActionButton>
            </div>
          ) : null}
          {!feed.loaded && !loadError ? (
            <p className="p-2 text-sm text-[color:var(--rs-text-muted)]">Loading {label}…</p>
          ) : null}
          {feed.loaded && feed.messages.length === 0 ? (
            <p className="p-2 text-sm text-[color:var(--rs-text-muted)]">
              No messages in {label} yet.
            </p>
          ) : null}
          <ol className="space-y-2">
            {feed.messages.map((message) => (
              <ChatMessageRow
                key={message.id}
                message={message}
                own={message.senderCharacterId === characterId}
              />
            ))}
          </ol>
        </div>

        {loadError ? (
          <div className="flex flex-wrap items-center gap-2">
            <Feedback tone="danger">{loadError}</Feedback>
            <ActionButton
              className="mt-3 min-h-9 px-3 py-1 text-xs"
              intent="secondary"
              onClick={() => void loadLatest(channel)}
            >
              Try again
            </ActionButton>
          </div>
        ) : null}

        <form
          className="space-y-2"
          data-chat-composer={channel}
          onSubmit={(event) => void submit(event)}
        >
          <label className="sr-only" htmlFor={composerId}>
            {promoting ? "Promoted Trade ad" : `Message ${label}`}
          </label>
          <textarea
            aria-describedby={`${counterId} ${pressureId}`}
            aria-invalid={overLimit || undefined}
            className="rs-bevel rs-focus block min-h-[4.5rem] w-full resize-none border bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)] placeholder:text-[color:var(--rs-text-muted)] focus:border-[color:var(--rs-accent-primary)]"
            id={composerId}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={promoting ? "Write your promoted ad" : `Message ${label}`}
            rows={2}
            value={draft}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SendPressureIndicator id={pressureId} now={now} pressure={pressure} />
            <span
              className={`text-xs tabular-nums ${overLimit ? "text-[color:var(--rs-accent-danger)]" : "text-[color:var(--rs-text-muted)]"}`}
              data-chat-counter=""
              id={counterId}
            >
              {overLimit
                ? `${trimmedLength - CHAT_POLICY.maxLength} over the ${CHAT_POLICY.maxLength}-character limit`
                : `${trimmedLength}/${CHAT_POLICY.maxLength}`}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {channel === "trade" ? (
              <ActionButton
                aria-pressed={promote}
                className="px-3"
                data-chat-promote=""
                intent={promote ? "primary" : "secondary"}
                onClick={() => setPromote((on) => !on)}
                type="button"
              >
                Promote
              </ActionButton>
            ) : null}
            <ActionButton
              className="ml-auto px-5"
              data-chat-send=""
              disabled={!canSend || (promoting && (adWaitMs > 0 || !canAfford))}
              loading={sending}
              type="submit"
            >
              {promoting ? `Post ad · ${adPrice} Credits` : "Send"}
            </ActionButton>
          </div>
          {promoting ? (
            <p className="text-xs text-[color:var(--rs-text-secondary)]" data-chat-promote-note="">
              {adWaitMs > 0
                ? `You can post another promoted ad in ${formatWait(adWaitMs)}.`
                : !canAfford
                  ? `A promoted ad costs ${adPrice} Credits. You have ${credits}.`
                  : `Shown in General and Trade. Costs ${adPrice} Credits (you have ${credits}); one ad every ${Math.round(CHAT_POLICY.promotedAd.cooldownMs / 60_000)} minutes.`}
            </p>
          ) : null}
          {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
        </form>
      </div>
    </div>
  );
}

function ChatMessageRow({ message, own }: { message: ChatMessageView; own: boolean }) {
  return (
    <li
      className={
        message.promoted
          ? "border border-[color:var(--rs-chat-promoted-border)] bg-[color:var(--rs-chat-promoted-surface)] px-3 py-2 [box-shadow:var(--rs-chat-promoted-glow)]"
          : "px-1"
      }
      data-chat-message={message.id}
      data-chat-promoted={message.promoted ? "" : undefined}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-[color:var(--rs-text-muted)]">
        <span
          className={`font-semibold ${own ? "text-[color:var(--rs-accent-primary)]" : "text-[color:var(--rs-text-secondary)]"}`}
        >
          {message.senderName}
          {own ? <span className="sr-only"> (you)</span> : null}
        </span>
        {message.promoted ? (
          <span className="font-display uppercase tracking-[0.12em] text-[color:var(--rs-chat-promoted-border)]">
            Promoted ad
          </span>
        ) : null}
        <time dateTime={message.sentAt}>{formatTime(message.sentAt)}</time>
      </p>
      <p
        className={`whitespace-pre-wrap break-words text-[color:var(--rs-text-primary)] [overflow-wrap:anywhere] ${message.promoted ? "text-base" : "text-sm"}`}
      >
        {message.body}
      </p>
    </li>
  );
}

function SendPressureIndicator({
  id,
  now,
  pressure,
}: {
  id: string;
  now: number;
  pressure: ReturnType<typeof composerPressure>;
}) {
  const color = `var(--rs-chat-pressure-${pressure.pressure})`;
  const full = pressure.pressure === "full" && pressure.readyAt !== undefined;
  const text = full
    ? `Slow down · ${secondsUntil(pressure.readyAt!, now)}s`
    : `${pressure.count}/${pressure.limit} in ${CHAT_POLICY.sendWindowMs / 1000}s`;
  return (
    <span
      className="flex items-center gap-2 text-xs"
      data-chat-pressure={pressure.pressure}
      id={id}
    >
      <span aria-hidden="true" className="flex gap-0.5">
        {Array.from({ length: pressure.limit }, (_, index) => (
          <span
            className="h-2 w-3 border"
            key={index}
            style={{
              borderColor: color,
              background: index < pressure.count ? color : "transparent",
            }}
          />
        ))}
      </span>
      <span
        style={{ color: full ? color : undefined }}
        className={full ? "font-semibold" : "text-[color:var(--rs-text-muted)]"}
      >
        <span className="sr-only">Send rate: </span>
        {text}
      </span>
    </span>
  );
}
