"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreditsAmount } from "@/components/ui/CreditsAmount";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { CHAT_POLICY, type ChatChannel } from "@/game/domain/chat";
import { GAMEPLAY_ACCESS_REQUIRED_CODE } from "@/game/domain/gameplay-access";
import {
  ChatMessageViewSchema,
  type ChatHistoryPage,
  type ChatSendResult,
  type VisibleChatMessageView,
} from "@/game/schemas/chat";
import { usePlay } from "@/features/play/PlayContext";
import { useSocial } from "@/features/social/SocialContext";
import {
  markChatMentionsReadAction,
  postPromotedTradeAdAction,
  sendChatMessageAction,
} from "@/server/actions";
import {
  applyLatestPage,
  applyMessage,
  applyOlderPage,
  composerPressure,
  EMPTY_CHAT_FEED,
  localAdReadyAt,
  localBudget,
  type ChatFeed,
  type LocalChatBudget,
} from "./chat-feed";
import { PUBLIC_CHAT_DRAFT_KEY } from "./chat-drafts";
import { ChatComposer } from "./ChatComposer";
import { useChat } from "./ChatContext";
import { ChatMessageRow, MessageActionButton, RedactedChatMessageRow } from "./ChatMessageRow";
import {
  atMentionLimit,
  mentionsShown,
  mergeMentionCandidates,
  type MentionCandidate,
} from "./mention-draft";
import { SafetyFlow, type SafetyOutcome, type SafetySubject } from "./SafetyFlow";

/**
 * General and Trade (issue #246), rendered inside the Chat/Social surface as
 * the channel `ChatConversations` has selected.
 *
 * Every message shown is durable: the latest page loads on open, older pages
 * on request, and after each stream (re)connect or tab resume the latest page
 * is re-read. Realtime deliveries only add messages sooner; all of it merges by
 * message id, so nothing renders twice. Sends are ordinary server actions whose
 * responses carry the account's authoritative send budget and ad cooldown,
 * which this tab then counts down locally without polling.
 *
 * Another player's message offers Whisper, Report, and Block (#247). A Block
 * on any tab of the account restarts both feeds from the server, so the
 * blocked account's messages turn into placeholders here at once (#261): the
 * server sends only their place, sender name, and time from then on, and the
 * full message again after an Unblock.
 *
 * `@mentions` (#261): the composer offers characters already in view — recent
 * senders in either feed, Whisper peers, and Nearby Players (read when a
 * mention starts) — and Send names the ones chosen. While a feed with unread
 * mentions of this character is on screen, they are marked read through the
 * newest message shown, on every tab and device.
 */

const CHANNEL_LABEL: Record<ChatChannel, string> = { general: "General", trade: "Trade" };

/** Nearby Players are re-read for mentions at most this often. */
const NEARBY_REFRESH_MS = 30_000;

/** The characters at this character's location, as mention candidates by exact name. */
async function fetchNearby(characterId: string): Promise<MentionCandidate[] | undefined> {
  try {
    const response = await fetch(
      `/api/location-population?${new URLSearchParams({ characterId })}`,
      {
        cache: "no-store",
        headers: { accept: "application/json" },
      },
    );
    if (!response.ok) return undefined;
    const body = (await response.json().catch(() => null)) as {
      characters?: { displayName?: unknown }[];
    } | null;
    if (!Array.isArray(body?.characters)) return undefined;
    return body.characters.flatMap((entry) =>
      typeof entry.displayName === "string"
        ? [{ name: entry.displayName, target: { name: entry.displayName } }]
        : [],
    );
  } catch {
    return undefined;
  }
}

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

function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

type SafetyAction = { mode: "report" | "block"; subject: SafetySubject };

export function PublicChat({
  characterId,
  channel,
}: {
  characterId: string;
  channel: ChatChannel;
}) {
  const router = useRouter();
  const { subscribe, onReconcile } = useSocial();
  const {
    blocksRevision,
    drafts,
    inbox,
    mentions,
    refreshMentions,
    refreshNotices,
    socialRestricted,
    startWhisper,
  } = useChat();
  const { requestAutoRefresh, state } = usePlay();
  const [feeds, setFeeds] = useState<Feeds>({ general: EMPTY_CHAT_FEED, trade: EMPTY_CHAT_FEED });
  const [loadError, setLoadError] = useState<string>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [budget, setBudget] = useState<LocalChatBudget>({ expiresAt: [] });
  const [adReadyAt, setAdReadyAt] = useState(0);
  const [adPrice, setAdPrice] = useState<number>(CHAT_POLICY.promotedAd.priceCredits);
  // The draft outlives this component: it unmounts whenever another desktop
  // utility is selected or a Drawer closes (#286), and typing must survive.
  const [draft, setDraft] = useState(() => drafts.read(PUBLIC_CHAT_DRAFT_KEY).text);
  const [promote, setPromote] = useState(() => drafts.read(PUBLIC_CHAT_DRAFT_KEY).promote);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<SafetyOutcome>();
  const [actionsFor, setActionsFor] = useState<string>();
  const [safety, setSafety] = useState<SafetyAction>();
  const [now, setNow] = useState(() => Date.now());
  const [chosenMentions, setChosenMentions] = useState<MentionCandidate[]>(
    () => drafts.read(PUBLIC_CHAT_DRAFT_KEY).mentions,
  );
  const [nearby, setNearby] = useState<MentionCandidate[]>([]);
  const nearbyReadAt = useRef(0);
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
  // Bumped when a Block restarts the feeds: pages requested before it may
  // still hold the blocked account's messages and are dropped.
  const feedGeneration = useRef(0);

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
      const generation = feedGeneration.current;
      const result = await fetchPage(characterId, target);
      if (generation !== feedGeneration.current) return;
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

  // A Block or Unblock (#247) changes which messages this account may see,
  // including ones already on screen: restart from the server's pages.
  const seenRevision = useRef(blocksRevision);
  useEffect(() => {
    if (seenRevision.current === blocksRevision) return;
    seenRevision.current = blocksRevision;
    const open = (["general", "trade"] as const).filter(
      (target) => feedsRef.current[target].loaded,
    );
    feedGeneration.current += 1;
    setFeeds({ general: EMPTY_CHAT_FEED, trade: EMPTY_CHAT_FEED });
    setActionsFor(undefined);
    for (const target of open) void loadLatest(target);
    if (!open.includes(channelRef.current)) void loadLatest(channelRef.current);
  }, [blocksRevision, loadLatest]);

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
    setActionsFor(undefined);
    setSafety(undefined);
    setFeedback(undefined);
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [channel]);

  async function loadOlder() {
    const oldest = feed.messages[0];
    if (!oldest || loadingOlder) return;
    const target = channel;
    setLoadingOlder(true);
    const request = ++requestCounter.current;
    const generation = feedGeneration.current;
    const result = await fetchPage(characterId, target, oldest.seq);
    setLoadingOlder(false);
    if (generation !== feedGeneration.current) return;
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

  // Mention candidates, most relevant first: recent senders in either feed
  // (newest first), then Whisper peers, then Nearby Players. Placeholders
  // carry no sender id, so a blocked player is never offered.
  const mentionCandidates = useMemo(() => {
    const senders = [...feeds.general.messages, ...feeds.trade.messages]
      .filter(
        (message): message is VisibleChatMessageView =>
          !message.redacted && message.senderCharacterId !== characterId,
      )
      .sort((a, b) => b.seq - a.seq)
      .map((message) => ({
        name: message.senderName,
        target: { characterId: message.senderCharacterId },
      }));
    const peers = (inbox?.conversations ?? [])
      .filter((conversation) => !conversation.peer.blockedByMe)
      .map((conversation) => ({
        name: conversation.peer.name,
        target: { characterId: conversation.peer.characterId },
      }));
    return mergeMentionCandidates([senders, peers, nearby]);
  }, [characterId, feeds, inbox, nearby]);

  // A chosen mention lives only while the draft still shows it: once its
  // `@Name` is edited away it is forgotten, so retyping that text by hand
  // later stays plain text.
  const changeDraft = useCallback((next: string) => {
    setDraft(next);
    setChosenMentions((chosen) => mentionsShown(next, chosen));
  }, []);
  const mentionLimitReached = atMentionLimit(draft, chosenMentions);
  useEffect(() => {
    drafts.write(PUBLIC_CHAT_DRAFT_KEY, { text: draft, mentions: chosenMentions, promote });
  }, [chosenMentions, draft, drafts, promote]);

  const loadNearby = useCallback(() => {
    const at = Date.now();
    if (at - nearbyReadAt.current < NEARBY_REFRESH_MS) return;
    nearbyReadAt.current = at;
    void fetchNearby(characterId).then((next) => {
      if (next) setNearby(next);
    });
  }, [characterId]);

  // Reading mentions: while this feed is on screen and holds unread mentions
  // of this character, mark them read through its newest message. Only while
  // the page is actually visible; a failed save retries on the next change.
  const unreadHere = mentions?.unread[channel] ?? 0;
  const newestShown = feed.loaded ? feed.messages.at(-1)?.seq : undefined;
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const markingMentions = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!pageVisible || unreadHere === 0 || newestShown === undefined) return;
    const key = `${channel}:${newestShown}:${unreadHere}`;
    if (markingMentions.current === key) return;
    markingMentions.current = key;
    markChatMentionsReadAction({ characterId, channel, throughSeq: newestShown }).then(
      (result) => {
        if (!("error" in result)) refreshMentions();
        else if (markingMentions.current === key) markingMentions.current = undefined;
      },
      () => {
        if (markingMentions.current === key) markingMentions.current = undefined;
      },
    );
  }, [channel, characterId, newestShown, pageVisible, refreshMentions, unreadHere]);

  const pressure = composerPressure(budget, channel, now);
  const promoting = channel === "trade" && promote;
  const adWaitMs = Math.max(0, adReadyAt - now);
  const credits = state.credits;
  const canAfford = credits >= adPrice;

  async function submit() {
    if (promoting && (adWaitMs > 0 || !canAfford)) return;
    const sentText = draft;
    const request = ++requestCounter.current;
    setSending(true);
    setFeedback(undefined);
    let result: ChatSendResult | { error: string };
    const mentionTargets = mentionsShown(draft, chosenMentions).map(
      (candidate) => candidate.target,
    );
    try {
      result = promoting
        ? await postPromotedTradeAdAction({ characterId, text: draft, mentions: mentionTargets })
        : await sendChatMessageAction({
            characterId,
            channel,
            text: draft,
            mentions: mentionTargets,
          });
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
      // A restriction this tab has not seen yet: read the notice so it shows.
      if (result.reason === "socially_restricted") refreshNotices();
      return;
    }
    const message = result.message;
    stickToBottom.current = true;
    setFeeds((current) => ({
      general: applyMessage(current.general, "general", message),
      trade: applyMessage(current.trade, "trade", message),
    }));
    // The send can outlive this component (the player switched utility while it
    // was in flight): spend the stored draft too, or it would come back.
    drafts.settle(PUBLIC_CHAT_DRAFT_KEY, sentText);
    setDraft("");
    setChosenMentions([]);
    if (message.promoted) {
      setPromote(false);
      setFeedback({ tone: "success", text: "Promoted ad posted to General and Trade." });
      // The Credits were spent server-side; let Play re-read its balance.
      requestAutoRefresh();
    }
  }

  async function whisper(message: VisibleChatMessageView) {
    setActionsFor(undefined);
    const error = await startWhisper({ characterId: message.senderCharacterId });
    if (error) setFeedback({ tone: "danger", text: error });
  }

  function beginSafety(mode: SafetyAction["mode"], message: VisibleChatMessageView) {
    setActionsFor(undefined);
    setFeedback(undefined);
    setSafety({
      mode,
      subject: {
        name: message.senderName,
        target: { characterId: message.senderCharacterId },
        messageId: mode === "report" ? message.id : undefined,
      },
    });
  }

  const label = CHANNEL_LABEL[channel];

  return (
    <div className="flex flex-1 flex-col gap-3" data-public-chat="">
      {/* The log scrolls inside the Chat/Social panel, which scrolls too. It
          deliberately keeps the browser's default scroll chaining: once the
          log is at its end, the same swipe moves the panel, so with a pinned
          card above it a phone player can still reach the newest message, the
          composer, and the panel footer without a nested-scroll dead end
          (#248). */}
      <div
        aria-label={`${label} messages`}
        className="relative h-[min(38dvh,22rem)] overflow-y-auto border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-2 [[data-docked-utility]_&]:min-h-[7rem] [[data-docked-utility]_&]:grow [[data-docked-utility]_&]:basis-[7rem]"
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
          {feed.messages.map((message) => {
            if (message.redacted) {
              return (
                <RedactedChatMessageRow
                  id={message.id}
                  key={message.id}
                  senderName={message.senderName}
                  sentAt={message.sentAt}
                />
              );
            }
            const own = message.senderCharacterId === characterId;
            return (
              <ChatMessageRow
                actions={
                  <>
                    <MessageActionButton onClick={() => void whisper(message)}>
                      Whisper
                    </MessageActionButton>
                    <MessageActionButton onClick={() => beginSafety("report", message)}>
                      Report
                    </MessageActionButton>
                    <MessageActionButton danger onClick={() => beginSafety("block", message)}>
                      Block
                    </MessageActionButton>
                  </>
                }
                actionsOpen={actionsFor === message.id}
                body={message.body}
                id={message.id}
                key={message.id}
                mentions={message.mentions}
                onToggleActions={
                  own
                    ? undefined
                    : () => setActionsFor((open) => (open === message.id ? undefined : message.id))
                }
                own={own}
                promoted={message.promoted}
                senderName={message.senderName}
                sentAt={message.sentAt}
                viewerCharacterId={characterId}
              />
            );
          })}
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

      {safety ? (
        <SafetyFlow
          mode={safety.mode}
          onDone={(outcome) => {
            setSafety(undefined);
            setFeedback(outcome);
          }}
          subject={safety.subject}
        />
      ) : (
        <ChatComposer
          controls={
            channel === "trade" ? (
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
            ) : null
          }
          dataChannel={channel}
          draft={draft}
          idPrefix="public-chat"
          label={promoting ? "Promoted Trade ad" : `Message ${label}`}
          mentionCandidates={mentionLimitReached ? [] : mentionCandidates}
          now={now}
          onDraftChange={changeDraft}
          onMentionChosen={(candidate) => setChosenMentions((chosen) => [...chosen, candidate])}
          onMentionQuery={loadNearby}
          onSubmit={() => void submit()}
          placeholder={
            promoting ? "Write your promoted ad" : `Message ${label} — type @ to mention`
          }
          pressure={pressure}
          sendBlocked={promoting && (adWaitMs > 0 || !canAfford)}
          socialRestricted={socialRestricted}
          sendLabel={
            promoting ? (
              <span>
                Post ad · <CreditsAmount amount={adPrice} />
              </span>
            ) : (
              "Send"
            )
          }
          sending={sending}
        >
          {mentionLimitReached ? (
            <p className="text-xs text-[color:var(--rs-text-secondary)]" data-chat-mention-limit="">
              A message can mention up to {CHAT_POLICY.maxMentions} players.
            </p>
          ) : null}
          {promoting ? (
            <p className="text-xs text-[color:var(--rs-text-secondary)]" data-chat-promote-note="">
              {adWaitMs > 0 ? (
                `You can post another promoted ad in ${formatWait(adWaitMs)}.`
              ) : !canAfford ? (
                <>
                  A promoted ad costs <CreditsAmount amount={adPrice} />. You have{" "}
                  <CreditsAmount amount={credits} unit={null} />.
                </>
              ) : (
                <>
                  Shown in General and Trade. Costs <CreditsAmount amount={adPrice} /> (you have{" "}
                  <CreditsAmount amount={credits} unit={null} />
                  ); one ad every {Math.round(CHAT_POLICY.promotedAd.cooldownMs / 60_000)} minutes.
                </>
              )}
            </p>
          ) : null}
        </ChatComposer>
      )}
      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
    </div>
  );
}
