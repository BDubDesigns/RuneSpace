"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { CHAT_POLICY, chatMessageLength } from "@/game/domain/chat";
import { secondsUntil, type ComposerPressure } from "./chat-feed";
import {
  activeMentionQuery,
  insertMention,
  matchMentionCandidates,
  type MentionCandidate,
} from "./mention-draft";

/**
 * The one chat composer (issues #246 and #247): General, Trade, and Whispers.
 * It states the 280-character limit with a live counter ("N over" rather than
 * silently cutting text) and shows the account's shared send pressure; the
 * owning view decides what Send does and supplies any extra controls (Trade's
 * Promote). Enter sends, Shift+Enter breaks a line.
 *
 * Given `mentionCandidates` (General and Trade, #261), typing `@` opens a list
 * of matching characters under the box; choosing one — tap, or arrows then
 * Enter/Tab — inserts `@Name` and reports the choice, which is what makes a
 * mention. Escape closes the list. The list sits in the form's flow rather
 * than floating, so the panel's scroll never clips it on a phone.
 */
export function ChatComposer({
  idPrefix,
  label,
  placeholder,
  draft,
  onDraftChange,
  onSubmit,
  pressure,
  now,
  sending,
  sendLabel = "Send",
  sendBlocked = false,
  socialRestricted = false,
  controls,
  children,
  dataChannel,
  mentionCandidates,
  onMentionChosen,
  onMentionQuery,
}: {
  idPrefix: string;
  label: string;
  placeholder: string;
  draft: string;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  pressure: ComposerPressure;
  now: number;
  sending: boolean;
  sendLabel?: string;
  /** Extra reasons Send is unavailable (for example an ad cooldown). */
  sendBlocked?: boolean;
  /**
   * A social restriction is in effect (#248): Send is held and a line points
   * at the pinned notice. Presentation only; the server refuses the send.
   */
  socialRestricted?: boolean;
  controls?: ReactNode;
  /** Notes and feedback under the controls. */
  children?: ReactNode;
  dataChannel: string;
  /** Characters `@` can mention, most relevant first; absent turns mentions off. */
  mentionCandidates?: readonly MentionCandidate[];
  onMentionChosen?: (candidate: MentionCandidate) => void;
  /** A mention query just began, for a view that loads candidates lazily. */
  onMentionQuery?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // The query the player closed (Escape) or just completed; typing reopens.
  const [closed, setClosed] = useState<string>();
  const pendingCaret = useRef<number | undefined>(undefined);
  const query = mentionCandidates ? activeMentionQuery(draft, caret) : undefined;
  const queryKey = query ? `${query.start}:${query.query}` : undefined;
  const options =
    query && mentionCandidates && queryKey !== closed
      ? matchMentionCandidates(mentionCandidates, query.query)
      : [];
  const listOpen = options.length > 0;
  const active = Math.min(activeIndex, Math.max(0, options.length - 1));

  const queryStart = query?.start;
  const onMentionQueryRef = useRef(onMentionQuery);
  onMentionQueryRef.current = onMentionQuery;
  useEffect(() => {
    if (queryStart !== undefined) onMentionQueryRef.current?.();
  }, [queryStart]);
  useEffect(() => setActiveIndex(0), [queryKey]);

  // Put the caret after an inserted mention once React has rendered it.
  useLayoutEffect(() => {
    const at = pendingCaret.current;
    const box = textareaRef.current;
    if (at === undefined || !box) return;
    pendingCaret.current = undefined;
    box.focus();
    box.setSelectionRange(at, at);
    setCaret(at);
  }, [draft]);

  function trackCaret() {
    const box = textareaRef.current;
    if (box) setCaret(box.selectionStart ?? box.value.length);
  }

  function choose(candidate: MentionCandidate) {
    if (!query) return;
    const next = insertMention(draft, query.start, caret, candidate.name);
    pendingCaret.current = next.caret;
    setClosed(`${query.start}:${next.draft.slice(query.start + 1, next.caret)}`);
    onDraftChange(next.draft);
    onMentionChosen?.(candidate);
  }

  const trimmedLength = chatMessageLength(draft.trim());
  const overLimit = trimmedLength > CHAT_POLICY.maxLength;
  const rateBlocked = pressure.pressure === "full";
  const canSend =
    trimmedLength > 0 &&
    !overLimit &&
    !rateBlocked &&
    !sending &&
    !sendBlocked &&
    !socialRestricted;
  const composerId = `${idPrefix}-composer`;
  const pressureId = `${idPrefix}-pressure`;
  const counterId = `${idPrefix}-counter`;
  const listId = `${idPrefix}-mentions`;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canSend) onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (listOpen && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((active + step + options.length) % options.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        // Tab chooses here; the Drawer's focus cycling must not also move.
        event.stopPropagation();
        choose(options[active]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Close the list only; the Drawer's own Escape is for closing it.
        event.stopPropagation();
        setClosed(queryKey);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form className="space-y-2" data-chat-composer={dataChannel} onSubmit={submit}>
      <label className="sr-only" htmlFor={composerId}>
        {label}
      </label>
      <textarea
        aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
        aria-autocomplete={mentionCandidates ? "list" : undefined}
        aria-controls={listOpen ? listId : undefined}
        aria-describedby={`${counterId} ${pressureId}`}
        aria-invalid={overLimit || undefined}
        className="rs-bevel rs-focus block min-h-[4.5rem] w-full resize-none border bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)] placeholder:text-[color:var(--rs-text-muted)] focus:border-[color:var(--rs-accent-primary)]"
        id={composerId}
        onChange={(event) => {
          setCaret(event.target.selectionStart ?? event.target.value.length);
          onDraftChange(event.target.value);
        }}
        onClick={trackCaret}
        onKeyDown={onKeyDown}
        onKeyUp={trackCaret}
        onSelect={trackCaret}
        placeholder={placeholder}
        ref={textareaRef}
        rows={2}
        value={draft}
      />
      {listOpen ? (
        <div
          aria-label="Mention a player"
          className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-1"
          data-chat-mention-options=""
          id={listId}
          role="listbox"
        >
          {options.map((candidate, index) => (
            <button
              aria-selected={index === active}
              className={`rs-focus flex min-h-[var(--rs-touch-target)] w-full items-center px-2 text-left text-sm outline-none [overflow-wrap:anywhere] ${index === active ? "bg-[color:var(--rs-accent-primary-subtle)] text-[color:var(--rs-chat-mention-accent)]" : "text-[color:var(--rs-text-primary)]"}`}
              data-chat-mention-option={candidate.name}
              id={`${listId}-${index}`}
              key={candidate.name}
              // Keep focus (and the caret) in the box while choosing.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(candidate)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              @{candidate.name}
            </button>
          ))}
        </div>
      ) : null}
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
        {controls}
        <ActionButton
          className="ml-auto px-5"
          data-chat-send=""
          disabled={!canSend}
          loading={sending}
          type="submit"
        >
          {sendLabel}
        </ActionButton>
      </div>
      {socialRestricted ? (
        <p
          className="text-xs text-[color:var(--rs-accent-danger)]"
          data-chat-restricted=""
          role="note"
        >
          You have a social restriction. See the notice above.
        </p>
      ) : null}
      {children}
    </form>
  );
}

function SendPressureIndicator({
  id,
  now,
  pressure,
}: {
  id: string;
  now: number;
  pressure: ComposerPressure;
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
