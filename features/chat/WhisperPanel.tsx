"use client";

import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { GAMEPLAY_ACCESS_REQUIRED_CODE } from "@/game/domain/gameplay-access";
import { SYSTEM_IDENTITY_NAME } from "@/game/domain/player-name";
import type { BlockedPlayersView } from "@/game/schemas/social-safety";
import {
  WhisperMessageViewSchema,
  type WhisperHistoryPage,
  type WhisperMessageView,
  type WhisperPeer,
  type WhisperSendResult,
} from "@/game/schemas/whispers";
import { useSocial } from "@/features/social/SocialContext";
import {
  hideWhisperConversationAction,
  markSystemNoticesReadAction,
  markWhisperReadAction,
  sendWhisperAction,
  unblockPlayerAction,
} from "@/server/actions";
import {
  applyLatestPage,
  applyOlderPage,
  composerPressure,
  EMPTY_FEED,
  insertMessage,
  localBudget,
  type Feed,
  type LocalChatBudget,
} from "./chat-feed";
import { ChatComposer } from "./ChatComposer";
import { useChat } from "./ChatContext";
import { ChatMessageRow, MessageActionButton } from "./ChatMessageRow";
import { SafetyFlow, type SafetyOutcome, type SafetySubject } from "./SafetyFlow";

/**
 * Whispers inside the Chat/Social surface (issue #247): the active
 * character's conversations with their durable unread counts, one open
 * conversation, the read-only System conversation (#274), and the account's
 * Blocked Players list. Which one shows is `ChatContext`'s view, so a
 * character-facing surface elsewhere in Play can open a conversation here
 * without navigating. A conversation can be hidden from this character's list
 * (#261) — never deleted — and returns with the next Whisper or by reopening.
 */
export function WhisperPanel() {
  const { view } = useChat();
  if (view.tab !== "whispers") return null;
  if (view.blockedPlayers) return <BlockedPlayers />;
  if (view.system) return <SystemConversation />;
  if (view.peer) return <WhisperConversation key={view.peer.characterId} peer={view.peer} />;
  return <WhisperInboxList hiddenName={view.hiddenName} />;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Start a Whisper with any character by exact name — nearby or not, online
 * or not. The server resolves the name; nothing is saved until the first
 * Whisper is sent. Deliberately one exact name, never a search or directory.
 */
function StartWhisperForm() {
  const { startWhisper } = useChat();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const inputId = "start-whisper-name";

  async function submit(event: FormEvent) {
    event.preventDefault();
    const target = name.trim();
    if (!target || pending) return;
    setPending(true);
    setError(undefined);
    const refusal = await startWhisper({ name: target });
    setPending(false);
    if (refusal) setError(refusal);
  }

  return (
    <form
      aria-labelledby="start-whisper-heading"
      className="space-y-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-start-whisper=""
      onSubmit={(event) => void submit(event)}
    >
      <h3
        className="font-display text-xs uppercase tracking-[0.14em] text-[color:var(--rs-text-secondary)]"
        id="start-whisper-heading"
      >
        Start a Whisper
      </h3>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={inputId}>
          Character name
        </label>
        <input
          aria-describedby={error ? `${inputId}-error` : undefined}
          aria-invalid={error ? true : undefined}
          autoCapitalize="words"
          autoComplete="off"
          className="rs-bevel rs-focus min-h-[var(--rs-touch-target)] min-w-0 flex-1 border bg-[color:var(--rs-surface-control)] px-3 text-sm text-[color:var(--rs-text-primary)] placeholder:text-[color:var(--rs-text-muted)] focus:border-[color:var(--rs-accent-primary)]"
          id={inputId}
          maxLength={64}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          placeholder="Exact character name"
          spellCheck={false}
          value={name}
        />
        <ActionButton className="px-4" disabled={!name.trim()} loading={pending} type="submit">
          Whisper
        </ActionButton>
      </div>
      {error ? (
        <p
          className="text-sm text-[color:var(--rs-accent-danger)]"
          id={`${inputId}-error`}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

function UnreadBadge({ unread }: { unread: number }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-[color:var(--rs-accent-primary)] px-1 font-display text-[10px] font-bold text-[color:var(--rs-accent-primary)] [box-shadow:var(--rs-glow-news-unread)]"
    >
      {unread > 9 ? "9+" : unread}
    </span>
  );
}

/**
 * The System conversation's row (#274), pinned above every player Whisper.
 * It looks like a conversation, but System is not a player: there is no
 * profile, Block, or Report behind it.
 */
function SystemConversationRow() {
  const { setView, system } = useChat();
  const latest = system?.notices.at(-1);
  if (!system || !latest) return null;
  const unread = system.unread;
  return (
    <li>
      <button
        aria-label={`${SYSTEM_IDENTITY_NAME}${unread > 0 ? `, ${unread} unread` : ""}`}
        className="rs-focus flex min-h-[var(--rs-touch-target)] w-full items-start gap-2 px-2 py-2 text-left outline-none hover:bg-[color:var(--rs-accent-primary-subtle)]"
        data-system-conversation=""
        data-system-unread={unread}
        onClick={() => setView({ tab: "whispers", system: true })}
        type="button"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              className={`min-w-0 truncate font-display text-sm ${unread > 0 ? "font-bold text-[color:var(--rs-text-primary)]" : "text-[color:var(--rs-text-secondary)]"}`}
            >
              {SYSTEM_IDENTITY_NAME}
            </span>
            <time
              className="ml-auto shrink-0 text-xs text-[color:var(--rs-text-muted)]"
              dateTime={latest.sentAt}
            >
              {formatWhen(latest.sentAt)}
            </time>
          </span>
          <span className="block truncate text-xs text-[color:var(--rs-text-muted)]">
            {latest.body.split("\n")[0]}
          </span>
        </span>
        {unread > 0 ? <UnreadBadge unread={unread} /> : null}
      </button>
    </li>
  );
}

function WhisperInboxList({ hiddenName }: { hiddenName?: string }) {
  const { characterId, inbox, setView, system } = useChat();
  const conversations = inbox?.conversations ?? [];
  const hasSystem = (system?.notices.length ?? 0) > 0;
  return (
    <div className="space-y-3" data-whisper-inbox="">
      <StartWhisperForm />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xs uppercase tracking-[0.14em] text-[color:var(--rs-text-secondary)]">
          Conversations
        </h3>
        <ActionButton
          className="min-h-9 px-3 py-1 text-xs"
          intent="secondary"
          onClick={() => setView({ tab: "whispers", blockedPlayers: true })}
        >
          Blocked players
        </ActionButton>
      </div>
      {hiddenName ? (
        <Feedback tone="success">
          Hid your conversation with {hiddenName}. A new Whisper from either of you brings it back,
          or start one by name to reopen it.
        </Feedback>
      ) : null}
      {!inbox && !hasSystem ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">Loading Whispers…</p>
      ) : null}
      {hasSystem || conversations.length > 0 ? (
        <ul
          aria-label="Whisper conversations"
          className="divide-y divide-[color:var(--rs-border-subtle)] border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)]"
        >
          <SystemConversationRow />
          {conversations.map((conversation) => {
            const { peer, unread, lastMessage } = conversation;
            const fromMe = lastMessage.senderCharacterId === characterId;
            return (
              <li key={peer.characterId}>
                <button
                  aria-label={`${peer.name}${unread > 0 ? `, ${unread} unread` : ""}`}
                  className="rs-focus flex min-h-[var(--rs-touch-target)] w-full items-start gap-2 px-2 py-2 text-left outline-none hover:bg-[color:var(--rs-accent-primary-subtle)]"
                  data-whisper-conversation={peer.characterId}
                  data-whisper-unread={unread}
                  onClick={() => setView({ tab: "whispers", peer })}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span
                        className={`min-w-0 truncate font-display text-sm ${unread > 0 ? "font-bold text-[color:var(--rs-text-primary)]" : "text-[color:var(--rs-text-secondary)]"}`}
                      >
                        {peer.name}
                      </span>
                      {peer.blockedByMe ? (
                        <span className="shrink-0 font-display text-[9px] uppercase tracking-[0.14em] text-[color:var(--rs-accent-danger)]">
                          Blocked
                        </span>
                      ) : null}
                      <time
                        className="ml-auto shrink-0 text-xs text-[color:var(--rs-text-muted)]"
                        dateTime={lastMessage.sentAt}
                      >
                        {formatWhen(lastMessage.sentAt)}
                      </time>
                    </span>
                    <span className="block truncate text-xs text-[color:var(--rs-text-muted)]">
                      {fromMe ? "You: " : ""}
                      {lastMessage.body}
                    </span>
                  </span>
                  {unread > 0 ? <UnreadBadge unread={unread} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {inbox && conversations.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">
          No Whispers yet. Start one above with a character&apos;s exact name, or tap a
          player&apos;s name in General or Trade.
        </p>
      ) : null}
    </div>
  );
}

function BackButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      className="rs-focus inline-flex min-h-9 items-center gap-1 px-1 text-xs font-semibold text-[color:var(--rs-text-secondary)] outline-none hover:text-[color:var(--rs-text-primary)]"
      onClick={onClick}
      type="button"
    >
      <ChevronLeft aria-hidden="true" className="h-4 w-4" />
      {children}
    </button>
  );
}

async function fetchConversation(
  characterId: string,
  withCharacterId: string,
  before?: number,
): Promise<{ page: WhisperHistoryPage } | { error: string; code?: string }> {
  const params = new URLSearchParams({ characterId, withCharacterId });
  if (before !== undefined) params.set("before", String(before));
  try {
    const response = await fetch(`/api/whispers/conversation?${params}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | (WhisperHistoryPage & { error?: undefined })
      | { error?: string; code?: string }
      | null;
    if (!response.ok || !body || "error" in body) {
      const refusal = body as { error?: string; code?: string } | null;
      return { error: refusal?.error ?? "Whispers could not be loaded.", code: refusal?.code };
    }
    return { page: body as WhisperHistoryPage };
  } catch {
    return { error: "Whispers could not be loaded." };
  }
}

type SafetyAction = { mode: "report" | "block"; subject: SafetySubject };

/** One conversation: durable history, live Whispers, and the composer. */
function WhisperConversation({ peer: initialPeer }: { peer: WhisperPeer }) {
  const router = useRouter();
  const { subscribe, onReconcile } = useSocial();
  const {
    blocksChanged,
    blocksRevision,
    characterId,
    refreshInbox,
    refreshNotices,
    setView,
    socialRestricted,
  } = useChat();
  const [peer, setPeer] = useState(initialPeer);
  const [feed, setFeed] = useState<Feed<WhisperMessageView>>(EMPTY_FEED);
  const [loadError, setLoadError] = useState<string>();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [budget, setBudget] = useState<LocalChatBudget>({ expiresAt: [] });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [unblocking, setUnblocking] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [feedback, setFeedback] = useState<SafetyOutcome>();
  const [actionsFor, setActionsFor] = useState<string>();
  const [safety, setSafety] = useState<SafetyAction>();
  const [now, setNow] = useState(() => Date.now());
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const olderAnchor = useRef<{ height: number; top: number } | undefined>(undefined);
  const requestCounter = useRef(0);
  const appliedRequest = useRef(0);
  const markedThrough = useRef(0);
  const peerId = initialPeer.characterId;

  const absorbBudget = useCallback(
    (result: { budget: WhisperHistoryPage["budget"] }, request: number) => {
      if (request < appliedRequest.current) return;
      appliedRequest.current = request;
      const receivedAt = Date.now();
      setBudget(localBudget(result.budget, receivedAt));
      setNow(receivedAt);
    },
    [],
  );

  const loadLatest = useCallback(async () => {
    const request = ++requestCounter.current;
    const result = await fetchConversation(characterId, peerId);
    if ("error" in result) {
      if (result.code === GAMEPLAY_ACCESS_REQUIRED_CODE) router.replace("/characters");
      else setLoadError(result.error);
      return;
    }
    setLoadError(undefined);
    absorbBudget(result.page, request);
    setPeer(result.page.peer);
    setFeed((current) => applyLatestPage(current, result.page));
  }, [absorbBudget, characterId, peerId, router]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);
  // Reconnect and tab resume re-read the conversation and retry a read
  // position that could not be saved.
  const [reconciled, setReconciled] = useState(0);
  useEffect(
    () =>
      onReconcile(() => {
        setReconciled((count) => count + 1);
        void loadLatest();
      }),
    [loadLatest, onReconcile],
  );

  // A Block or Unblock on any tab of the account changes whether this
  // conversation can continue; history itself never disappears.
  const seenRevision = useRef(blocksRevision);
  useEffect(() => {
    if (seenRevision.current === blocksRevision) return;
    seenRevision.current = blocksRevision;
    void loadLatest();
  }, [blocksRevision, loadLatest]);

  useEffect(
    () =>
      subscribe("whisper.message", (data) => {
        const parsed = WhisperMessageViewSchema.safeParse(data);
        if (!parsed.success) return;
        const message = parsed.data;
        const pair = [message.senderCharacterId, message.recipientCharacterId];
        if (!pair.includes(peerId) || !pair.includes(characterId)) return;
        setFeed((current) => insertMessage(current, message));
      }),
    [characterId, peerId, subscribe],
  );

  // Reading here clears this character's unread for the conversation on every
  // tab and device: advance the durable read position past what is shown, but
  // only while the page is actually visible.
  const newestIncoming = [...feed.messages]
    .reverse()
    .find((message) => message.senderCharacterId === peerId)?.seq;
  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!pageVisible) return;
    if (newestIncoming === undefined || newestIncoming <= markedThrough.current) return;
    const through = newestIncoming;
    markedThrough.current = through;
    const retryLater = () => {
      if (markedThrough.current === through) markedThrough.current = 0;
    };
    markWhisperReadAction({ characterId, withCharacterId: peerId, throughSeq: through }).then(
      (result) => {
        if ("error" in result) retryLater();
        else refreshInbox();
      },
      retryLater,
    );
  }, [characterId, newestIncoming, pageVisible, peerId, reconciled, refreshInbox]);

  const ticking = budget.expiresAt.some((at) => at > now);
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);

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

  async function loadOlder() {
    const oldest = feed.messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    const request = ++requestCounter.current;
    const result = await fetchConversation(characterId, peerId, oldest.seq);
    setLoadingOlder(false);
    if ("error" in result) {
      if (result.code === GAMEPLAY_ACCESS_REQUIRED_CODE) router.replace("/characters");
      else setLoadError(result.error);
      return;
    }
    const log = logRef.current;
    if (log) olderAnchor.current = { height: log.scrollHeight, top: log.scrollTop };
    absorbBudget(result.page, request);
    setFeed((current) => applyOlderPage(current, result.page));
  }

  async function submit() {
    const request = ++requestCounter.current;
    setSending(true);
    setFeedback(undefined);
    let result: WhisperSendResult | { error: string };
    try {
      result = await sendWhisperAction({ characterId, recipientCharacterId: peerId, text: draft });
    } catch {
      result = { error: "Whisper not sent. Check your connection and try again." };
    }
    setSending(false);
    if (!("status" in result)) {
      setFeedback({ tone: "danger", text: result.error });
      return;
    }
    absorbBudget(result, request);
    if (result.status === "refused") {
      setFeedback({ tone: "danger", text: result.error });
      if (result.reason === "blocked_by_you") void loadLatest();
      // A restriction this tab has not seen yet: read the notice so it shows.
      if (result.reason === "socially_restricted") refreshNotices();
      return;
    }
    stickToBottom.current = true;
    setFeed((current) => insertMessage(current, result.message));
    setDraft("");
    refreshInbox();
  }

  async function unblock() {
    setUnblocking(true);
    setFeedback(undefined);
    let result: Awaited<ReturnType<typeof unblockPlayerAction>>;
    try {
      result = await unblockPlayerAction({ characterId, blockedCharacterId: peerId });
    } catch {
      result = { error: "Unblock failed. Check your connection and try again." };
    }
    setUnblocking(false);
    if ("error" in result) {
      setFeedback({ tone: "danger", text: result.error });
      return;
    }
    blocksChanged();
    setFeedback({ tone: "success", text: `Unblocked ${result.name}.` });
  }

  /**
   * Hide this conversation from this character's list (#261) through the
   * newest Whisper shown here; a newer one keeps it listed.
   */
  async function hide() {
    const newest = feed.messages.at(-1);
    if (!newest) return;
    setHiding(true);
    setFeedback(undefined);
    let result: Awaited<ReturnType<typeof hideWhisperConversationAction>>;
    try {
      result = await hideWhisperConversationAction({
        characterId,
        withCharacterId: peerId,
        throughSeq: newest.seq,
      });
    } catch {
      result = { error: "Couldn't hide the conversation. Check your connection and try again." };
    }
    setHiding(false);
    if ("error" in result) {
      setFeedback({ tone: "danger", text: result.error });
      return;
    }
    refreshInbox();
    setView({ tab: "whispers", hiddenName: peer.name });
  }

  function beginSafety(mode: SafetyAction["mode"], message?: WhisperMessageView) {
    setActionsFor(undefined);
    setFeedback(undefined);
    setSafety({
      mode,
      subject: {
        name: message?.senderName ?? peer.name,
        target: { characterId: peerId },
        messageId: mode === "report" ? message?.id : undefined,
      },
    });
  }

  const pressure = composerPressure(budget, "whisper", now);

  return (
    <div className="space-y-3" data-whisper-conversation-view={peerId}>
      <div className="flex flex-wrap items-center gap-2">
        <BackButton onClick={() => setView({ tab: "whispers" })}>All Whispers</BackButton>
        <h3 className="min-w-0 flex-1 truncate font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
          <span className="sr-only">Whispers with </span>
          {peer.name}
        </h3>
        <div className="flex flex-wrap gap-1">
          {feed.messages.length > 0 ? (
            <MessageActionButton disabled={hiding} onClick={() => void hide()}>
              Hide
            </MessageActionButton>
          ) : null}
          <MessageActionButton onClick={() => beginSafety("report")}>Report</MessageActionButton>
          {peer.blockedByMe ? null : (
            <MessageActionButton danger onClick={() => beginSafety("block")}>
              Block
            </MessageActionButton>
          )}
        </div>
      </div>

      {/* The conversation scrolls inside the Chat/Social panel, which scrolls
          too. It deliberately keeps the browser's default scroll chaining:
          once the conversation is at its end, the same swipe moves the panel,
          so with a pinned card above it a phone player can still reach the
          newest Whisper, the composer, and the panel footer without a
          nested-scroll dead end (#248). */}
      <div
        aria-label={`Whispers with ${peer.name}`}
        className="h-[min(34dvh,20rem)] overflow-y-auto border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-2"
        data-whisper-log={peerId}
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
          <p className="p-2 text-sm text-[color:var(--rs-text-muted)]">Loading Whispers…</p>
        ) : null}
        {feed.loaded && feed.messages.length === 0 ? (
          <p className="p-2 text-sm text-[color:var(--rs-text-muted)]">
            No Whispers with {peer.name} yet.
          </p>
        ) : null}
        <ol className="space-y-2">
          {feed.messages.map((message) => {
            const own = message.senderCharacterId === characterId;
            return (
              <ChatMessageRow
                actions={
                  <>
                    <MessageActionButton onClick={() => beginSafety("report", message)}>
                      Report
                    </MessageActionButton>
                    {peer.blockedByMe ? null : (
                      <MessageActionButton danger onClick={() => beginSafety("block", message)}>
                        Block
                      </MessageActionButton>
                    )}
                  </>
                }
                actionsOpen={actionsFor === message.id}
                body={message.body}
                id={message.id}
                key={message.id}
                onToggleActions={
                  own
                    ? undefined
                    : () => setActionsFor((open) => (open === message.id ? undefined : message.id))
                }
                own={own}
                senderName={message.senderName}
                sentAt={message.sentAt}
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
            onClick={() => void loadLatest()}
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
      ) : peer.blockedByMe ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
          data-whisper-blocked=""
        >
          <p className="text-sm text-[color:var(--rs-text-secondary)]">
            You blocked {peer.name}. Unblock them to send a Whisper.
          </p>
          <ActionButton
            className="px-3"
            intent="secondary"
            loading={unblocking}
            onClick={() => void unblock()}
          >
            Unblock
          </ActionButton>
        </div>
      ) : (
        <ChatComposer
          dataChannel="whisper"
          draft={draft}
          idPrefix="whisper"
          label={`Whisper to ${peer.name}`}
          now={now}
          onDraftChange={setDraft}
          onSubmit={() => void submit()}
          placeholder={`Whisper to ${peer.name}`}
          pressure={pressure}
          sending={sending}
          socialRestricted={socialRestricted}
        />
      )}
      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
    </div>
  );
}

/**
 * The read-only System conversation (#274): the character's recipe-unlock
 * notices, oldest first. It deliberately has no composer, Reply, profile,
 * Block, or Report — System is RuneSpace, not a player. Reading it marks the
 * shown notices read on every tab and device, but only while the page is
 * actually visible.
 */
function SystemConversation() {
  const { characterId, refreshSystem, setView, system } = useChat();
  const logRef = useRef<HTMLDivElement>(null);
  const markedThrough = useRef(0);
  const notices = system?.notices ?? [];
  const newest = notices.at(-1)?.seq;
  const unread = system?.unread ?? 0;

  // Opening System re-reads it, so a notice that committed while the panel
  // was closed is never missing from what is marked read.
  useEffect(() => {
    refreshSystem();
  }, [refreshSystem]);

  const [pageVisible, setPageVisible] = useState(true);
  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!pageVisible || unread === 0) return;
    if (newest === undefined || newest <= markedThrough.current) return;
    const through = newest;
    markedThrough.current = through;
    const retryLater = () => {
      if (markedThrough.current === through) markedThrough.current = 0;
    };
    markSystemNoticesReadAction({ characterId, throughSeq: through }).then((result) => {
      if ("error" in result) retryLater();
      else refreshSystem();
    }, retryLater);
  }, [characterId, newest, pageVisible, refreshSystem, unread]);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [notices.length]);

  return (
    <div className="space-y-3" data-system-conversation-view="">
      <div className="flex flex-wrap items-center gap-2">
        <BackButton onClick={() => setView({ tab: "whispers" })}>All Whispers</BackButton>
        <h3 className="min-w-0 flex-1 truncate font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
          {SYSTEM_IDENTITY_NAME}
        </h3>
      </div>
      <div
        aria-label={`Messages from ${SYSTEM_IDENTITY_NAME}`}
        className="h-[min(34dvh,20rem)] overflow-y-auto border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-2"
        data-system-log=""
        ref={logRef}
        role="log"
        tabIndex={0}
      >
        {!system ? (
          <p className="p-2 text-sm text-[color:var(--rs-text-muted)]">Loading…</p>
        ) : notices.length === 0 ? (
          <p className="p-2 text-sm text-[color:var(--rs-text-muted)]">No System messages yet.</p>
        ) : null}
        <ol className="space-y-2">
          {notices.map((notice) => (
            <ChatMessageRow
              body={notice.body}
              id={notice.id}
              key={notice.id}
              own={false}
              senderName={SYSTEM_IDENTITY_NAME}
              sentAt={notice.sentAt}
            />
          ))}
        </ol>
      </div>
      <p className="text-xs text-[color:var(--rs-text-muted)]" data-system-read-only="">
        System messages are sent automatically. You can&apos;t reply to them.
      </p>
    </div>
  );
}

async function fetchBlocked(
  characterId: string,
): Promise<{ view: BlockedPlayersView } | { error: string; code?: string }> {
  try {
    const response = await fetch(`/api/blocked-players?${new URLSearchParams({ characterId })}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | (BlockedPlayersView & { error?: undefined })
      | { error?: string; code?: string }
      | null;
    if (!response.ok || !body || "error" in body) {
      const refusal = body as { error?: string; code?: string } | null;
      return {
        error: refusal?.error ?? "Blocked players could not be loaded.",
        code: refusal?.code,
      };
    }
    return { view: body as BlockedPlayersView };
  } catch {
    return { error: "Blocked players could not be loaded." };
  }
}

/** The account's Blocked Players, each with a deliberate Unblock. */
function BlockedPlayers() {
  const router = useRouter();
  const { blocksChanged, blocksRevision, characterId, setView } = useChat();
  const [view, setBlockedView] = useState<BlockedPlayersView>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [feedback, setFeedback] = useState<SafetyOutcome>();

  useEffect(() => {
    let cancelled = false;
    void fetchBlocked(characterId).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        if (result.code === GAMEPLAY_ACCESS_REQUIRED_CODE) router.replace("/characters");
        else setError(result.error);
        return;
      }
      setError(undefined);
      setBlockedView(result.view);
    });
    return () => {
      cancelled = true;
    };
  }, [blocksRevision, characterId, router]);

  async function unblock(blockedCharacterId: string) {
    setPending(blockedCharacterId);
    setFeedback(undefined);
    let result: Awaited<ReturnType<typeof unblockPlayerAction>>;
    try {
      result = await unblockPlayerAction({ characterId, blockedCharacterId });
    } catch {
      result = { error: "Unblock failed. Check your connection and try again." };
    }
    setPending(undefined);
    if ("error" in result) {
      setFeedback({ tone: "danger", text: result.error });
      return;
    }
    setFeedback({ tone: "success", text: `Unblocked ${result.name}.` });
    blocksChanged();
  }

  return (
    <section
      aria-labelledby="blocked-players-heading"
      className="space-y-3"
      data-blocked-players=""
    >
      <BackButton onClick={() => setView({ tab: "whispers" })}>All Whispers</BackButton>
      <div>
        <h3
          className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]"
          id="blocked-players-heading"
        >
          Blocked players
        </h3>
        <p className="mt-1 text-xs text-[color:var(--rs-text-secondary)]">
          A block covers all of that player&apos;s characters. They aren&apos;t told, and it lasts
          until you unblock them.
        </p>
      </div>
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      {!view && !error ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">Loading…</p>
      ) : view && view.blocked.length === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-muted)]">
          You haven&apos;t blocked anyone.
        </p>
      ) : view ? (
        <ul className="divide-y divide-[color:var(--rs-border-subtle)] border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)]">
          {view.blocked.map((entry) => (
            <li
              className="flex flex-wrap items-center gap-2 px-2 py-2"
              data-blocked-player={entry.characterId}
              key={entry.characterId}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
                  {entry.name}
                </span>
                {entry.playerName ? (
                  <span className="block truncate text-xs text-[color:var(--rs-text-secondary)]">
                    Player: {entry.playerName}
                  </span>
                ) : null}
              </span>
              <ActionButton
                aria-label={`Unblock ${entry.name}`}
                className="min-h-9 px-3 py-1 text-xs"
                intent="secondary"
                loading={pending === entry.characterId}
                onClick={() => void unblock(entry.characterId)}
              >
                Unblock
              </ActionButton>
            </li>
          ))}
        </ul>
      ) : null}
      {feedback ? <Feedback tone={feedback.tone}>{feedback.text}</Feedback> : null}
    </section>
  );
}
