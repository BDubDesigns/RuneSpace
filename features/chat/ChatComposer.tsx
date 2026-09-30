"use client";

import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { CHAT_POLICY, chatMessageLength } from "@/game/domain/chat";
import { secondsUntil, type ComposerPressure } from "./chat-feed";

/**
 * The one chat composer (issues #246 and #247): General, Trade, and Whispers.
 * It states the 280-character limit with a live counter ("N over" rather than
 * silently cutting text) and shows the account's shared send pressure; the
 * owning view decides what Send does and supplies any extra controls (Trade's
 * Promote). Enter sends, Shift+Enter breaks a line.
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
}) {
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

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canSend) onSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
        aria-describedby={`${counterId} ${pressureId}`}
        aria-invalid={overLimit || undefined}
        className="rs-bevel rs-focus block min-h-[4.5rem] w-full resize-none border bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)] placeholder:text-[color:var(--rs-text-muted)] focus:border-[color:var(--rs-accent-primary)]"
        id={composerId}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
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
