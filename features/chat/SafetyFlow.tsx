"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { chatMessageLength } from "@/game/domain/chat";
import {
  REPORT_POLICY,
  REPORT_REASON_LABEL,
  REPORT_REASONS,
  type ReportReason,
} from "@/game/domain/social-safety";
import type { CharacterTarget } from "@/game/schemas/whispers";
import type { ReportResult } from "@/game/schemas/social-safety";
import { blockPlayerAction, reportMessageAction, reportPlayerAction } from "@/server/actions";
import { useChat } from "./ChatContext";

/**
 * The player-safety flows (issue #247), shared by every surface that offers
 * them: a chat message's actions, a Whisper conversation, and the same-location
 * character profile.
 *
 * - **Block** asks once, says plainly what it does, and never tells the other
 *   player.
 * - **Report** takes a reason and an optional short note, and offers "Also
 *   block" as the combined Report + Block path. Reporting alone never blocks.
 *
 * The server decides everything; this only collects the choice and reports
 * the outcome through `onDone`.
 */

/** Who (and, for a message report, which message) a flow is about. */
export type SafetySubject = {
  /** The character name the player sees. */
  name: string;
  target: CharacterTarget;
  /** Set for Report Message; absent for Report Player. */
  messageId?: string;
};

export type SafetyOutcome = { tone: "success" | "danger"; text: string };

export function SafetyFlow({
  mode,
  subject,
  onDone,
}: {
  mode: "report" | "block";
  subject: SafetySubject;
  /** Closed, with the outcome to show, or undefined when cancelled. */
  onDone: (outcome?: SafetyOutcome) => void;
}) {
  return mode === "block" ? (
    <BlockConfirm onDone={onDone} subject={subject} />
  ) : (
    <ReportForm onDone={onDone} subject={subject} />
  );
}

function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function BlockConfirm({
  subject,
  onDone,
}: {
  subject: SafetySubject;
  onDone: (outcome?: SafetyOutcome) => void;
}) {
  const { blocksChanged, characterId } = useChat();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const headingId = useId();

  async function confirm() {
    setPending(true);
    setError(undefined);
    let result: Awaited<ReturnType<typeof blockPlayerAction>>;
    try {
      result = await blockPlayerAction({ characterId, target: subject.target });
    } catch {
      result = { error: "Block failed. Check your connection and try again." };
    }
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    blocksChanged();
    onDone({
      tone: "success",
      text: `Blocked ${result.name}. Manage blocks in Chat under Whispers › Blocked players.`,
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2 border border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-surface-panel)] p-3"
      data-safety-block=""
    >
      <h3
        className="rs-focus font-display text-sm font-bold text-[color:var(--rs-text-primary)] outline-none"
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
      >
        Block {subject.name}?
      </h3>
      <p className="text-sm text-[color:var(--rs-text-secondary)]">
        You won&apos;t see their General or Trade messages, and neither of you can Whisper the
        other. It covers all of their characters and lasts until you unblock them. They won&apos;t
        be told.
      </p>
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      <div className="flex flex-wrap gap-2">
        <ActionButton intent="danger" loading={pending} onClick={() => void confirm()}>
          Block
        </ActionButton>
        <ActionButton disabled={pending} intent="secondary" onClick={() => onDone()}>
          Cancel
        </ActionButton>
      </div>
    </section>
  );
}

function reportOutcome(result: Exclude<ReportResult, { error: string }>): SafetyOutcome {
  const reported =
    result.status === "duplicate"
      ? "You've already reported this message."
      : "Report sent. RuneSpace will review it.";
  return {
    tone: "success",
    text: result.blocked ? `${reported} You've blocked ${result.name}.` : reported,
  };
}

function ReportForm({
  subject,
  onDone,
}: {
  subject: SafetySubject;
  onDone: (outcome?: SafetyOutcome) => void;
}) {
  const { blocksChanged, characterId } = useChat();
  const [reason, setReason] = useState<ReportReason>();
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  const noteLength = chatMessageLength(note.trim());
  const noteOver = noteLength > REPORT_POLICY.noteMaxLength;
  const title = subject.messageId ? "Report message" : `Report ${subject.name}`;
  const ids = useId();
  const headingId = `${ids}-heading`;
  const noteId = `${ids}-note`;
  const counterId = `${ids}-note-counter`;
  const reasonName = `${ids}-reason`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason || noteOver || pending) return;
    setPending(true);
    setError(undefined);
    let result: ReportResult;
    try {
      result = subject.messageId
        ? await reportMessageAction({
            characterId,
            messageId: subject.messageId,
            reason,
            note,
            alsoBlock,
          })
        : await reportPlayerAction({
            characterId,
            target: subject.target,
            reason,
            note,
            alsoBlock,
          });
    } catch {
      result = { error: "Report failed. Check your connection and try again." };
    }
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (result.blocked) blocksChanged();
    onDone(reportOutcome(result));
  }

  return (
    <form
      aria-labelledby={headingId}
      className="space-y-3 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-safety-report=""
      onSubmit={(event) => void submit(event)}
    >
      <div>
        <h3
          className="rs-focus font-display text-sm font-bold text-[color:var(--rs-text-primary)] outline-none"
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
        >
          {title}
        </h3>
        <p className="mt-1 text-xs text-[color:var(--rs-text-secondary)]">
          {subject.messageId
            ? `From ${subject.name}. The message and a little of the conversation around it are saved for review.`
            : "For behaviour that isn't one message. RuneSpace will review it."}{" "}
          They won&apos;t be told who reported them.
        </p>
      </div>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs font-semibold text-[color:var(--rs-text-primary)]">
          Reason
        </legend>
        {REPORT_REASONS.map((option) => (
          <label
            className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-[color:var(--rs-text-primary)]"
            key={option}
          >
            <input
              checked={reason === option}
              className="h-4 w-4 accent-[color:var(--rs-accent-primary)]"
              name={reasonName}
              onChange={() => setReason(option)}
              type="radio"
              value={option}
            />
            {REPORT_REASON_LABEL[option]}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <label
          className="text-xs font-semibold text-[color:var(--rs-text-primary)]"
          htmlFor={noteId}
        >
          Note (optional)
        </label>
        <textarea
          aria-describedby={counterId}
          aria-invalid={noteOver || undefined}
          className="rs-bevel rs-focus block min-h-[3.5rem] w-full resize-none border bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)] focus:border-[color:var(--rs-accent-primary)]"
          id={noteId}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          value={note}
        />
        <p
          className={`text-right text-xs tabular-nums ${noteOver ? "text-[color:var(--rs-accent-danger)]" : "text-[color:var(--rs-text-muted)]"}`}
          id={counterId}
        >
          {noteLength}/{REPORT_POLICY.noteMaxLength}
        </p>
      </div>
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-[color:var(--rs-text-primary)]">
        <input
          checked={alsoBlock}
          className="h-4 w-4 accent-[color:var(--rs-accent-danger)]"
          onChange={(event) => setAlsoBlock(event.target.checked)}
          type="checkbox"
        />
        Also block {subject.name}
      </label>
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      <div className="flex flex-wrap gap-2">
        <ActionButton disabled={!reason || noteOver} loading={pending} type="submit">
          {alsoBlock ? "Report and block" : "Send report"}
        </ActionButton>
        <ActionButton disabled={pending} intent="secondary" onClick={() => onDone()}>
          Cancel
        </ActionButton>
      </div>
    </form>
  );
}
