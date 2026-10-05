"use client";

import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import type { ChatMentionView } from "@/game/schemas/chat";
import { mentionSegments } from "./mention-draft";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * One chat message in a log (General, Trade, or a Whisper conversation). Plain
 * text, wrapped anywhere so a long word never overflows. Another player's
 * message opens its actions from its sender's name or a "…" toggle; when
 * expanded, the owning view's actions (Whisper, Report, Block — issue #247)
 * sit under the body.
 *
 * A public message's resolved `@mentions` (#261) are marked in the body, and
 * one that mentions the viewer's character carries the mention rim and a
 * "Mentions you" label — personal, but never an alert.
 */
export function ChatMessageRow({
  id,
  senderName,
  body,
  sentAt,
  own,
  promoted = false,
  actionsOpen = false,
  onToggleActions,
  actions,
  mentions = [],
  viewerCharacterId,
}: {
  id: string;
  senderName: string;
  body: string;
  sentAt: string;
  own: boolean;
  promoted?: boolean;
  actionsOpen?: boolean;
  onToggleActions?: () => void;
  actions?: ReactNode;
  mentions?: readonly ChatMentionView[];
  /** The viewer's character, to tell whether a mention is theirs. */
  viewerCharacterId?: string;
}) {
  const actionsId = `chat-message-actions-${id}`;
  const mentionsMe =
    viewerCharacterId !== undefined &&
    mentions.some((mention) => mention.characterId === viewerCharacterId);
  return (
    <li
      className={`${
        promoted
          ? "border border-[color:var(--rs-chat-promoted-border)] bg-[color:var(--rs-chat-promoted-surface)] px-3 py-2 [box-shadow:var(--rs-chat-promoted-glow)]"
          : "px-1"
      } ${mentionsMe ? "border-l-4 border-l-[color:var(--rs-chat-mention-accent)] pl-2" : ""}`}
      data-chat-mentions-me={mentionsMe ? "" : undefined}
      data-chat-message={id}
      data-chat-promoted={promoted ? "" : undefined}
    >
      <div className="flex items-start gap-1">
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-xs text-[color:var(--rs-text-muted)]">
          {onToggleActions ? (
            // Tapping a name is the natural way in on a phone: it opens the
            // same Whisper / Report / Block actions as the "…" control.
            <button
              aria-expanded={actionsOpen}
              className="rs-focus break-words font-semibold text-[color:var(--rs-text-secondary)] underline decoration-dotted underline-offset-2 outline-none [overflow-wrap:anywhere] hover:text-[color:var(--rs-text-primary)]"
              data-chat-sender=""
              onClick={onToggleActions}
              type="button"
            >
              {senderName}
            </button>
          ) : (
            <span
              className={`break-words font-semibold [overflow-wrap:anywhere] ${own ? "text-[color:var(--rs-accent-primary)]" : "text-[color:var(--rs-text-secondary)]"}`}
            >
              {senderName}
              {own ? <span className="sr-only"> (you)</span> : null}
            </span>
          )}
          {promoted ? (
            <span className="font-display uppercase tracking-[0.12em] text-[color:var(--rs-chat-promoted-border)]">
              Promoted ad
            </span>
          ) : null}
          {mentionsMe ? (
            <span
              className="font-display uppercase tracking-[0.12em] text-[color:var(--rs-chat-mention-accent)]"
              data-chat-mention-label=""
            >
              Mentions you
            </span>
          ) : null}
          <time dateTime={sentAt}>{formatTime(sentAt)}</time>
        </p>
        {onToggleActions ? (
          <button
            aria-controls={actionsOpen ? actionsId : undefined}
            aria-expanded={actionsOpen}
            aria-label={`Actions for ${senderName}'s message`}
            className={`rs-focus -my-1 flex h-8 w-9 shrink-0 items-center justify-center border outline-none ${actionsOpen ? "border-[color:var(--rs-accent-primary)] text-[color:var(--rs-accent-primary)]" : "border-transparent text-[color:var(--rs-text-muted)] hover:text-[color:var(--rs-text-primary)]"}`}
            data-chat-message-actions-toggle=""
            onClick={onToggleActions}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <p
        className={`whitespace-pre-wrap break-words text-[color:var(--rs-text-primary)] [overflow-wrap:anywhere] ${promoted ? "text-base" : "text-sm"}`}
      >
        {mentionSegments(body, mentions).map((segment, index) =>
          segment.mention ? (
            <span
              className={`font-semibold ${segment.mention.characterId === viewerCharacterId ? "text-[color:var(--rs-chat-mention-accent)]" : "text-[color:var(--rs-chat-mention-other)]"}`}
              data-chat-mention={segment.mention.characterId}
              key={index}
            >
              {segment.text}
            </span>
          ) : (
            segment.text
          ),
        )}
      </p>
      {actionsOpen && actions ? (
        <div
          className="mt-1 flex flex-wrap gap-1"
          data-chat-message-actions=""
          id={actionsId}
          role="group"
          aria-label={`Actions for ${senderName}'s message`}
        >
          {actions}
        </div>
      ) : null}
    </li>
  );
}

/**
 * An automatic System line in General (#308), today a Mining RARE FIND. It is
 * plainly RuneSpace's own output: named "System", carrying the restrained
 * RARE FIND treatment, with no sender to open and so no Whisper, Report, or
 * Block, and it can mention no one.
 */
export function SystemChatMessageRow({
  id,
  body,
  sentAt,
  treatment,
}: {
  id: string;
  body: string;
  sentAt: string;
  treatment: "rare_find";
}) {
  return (
    <li
      className="border-l-4 border-l-[color:var(--rs-rare-find-accent)] bg-[color:var(--rs-rare-find-surface)] px-3 py-2"
      data-chat-message={id}
      data-chat-system={treatment}
    >
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-[color:var(--rs-text-muted)]">
        <span
          className="font-semibold text-[color:var(--rs-text-secondary)]"
          data-chat-sender-system=""
        >
          System
        </span>
        <span
          className="font-display uppercase tracking-[0.12em] text-[color:var(--rs-rare-find-accent)]"
          data-rare-find-label=""
        >
          RARE FIND
        </span>
        <time dateTime={sentAt}>{formatTime(sentAt)}</time>
      </p>
      <p className="whitespace-pre-wrap break-words text-sm text-[color:var(--rs-text-primary)] [overflow-wrap:anywhere]">
        {body}
      </p>
    </li>
  );
}

/**
 * A public message from an account the viewer blocked (#261). The server sent
 * only its place, sender name at send, and time, so there is nothing to
 * reveal: no body, no actions, and no tap target. The hidden line is subdued,
 * not a warning — it only explains whom the surrounding replies answer.
 */
export function RedactedChatMessageRow({
  id,
  senderName,
  sentAt,
}: {
  id: string;
  senderName: string;
  sentAt: string;
}) {
  return (
    <li className="px-1" data-chat-message={id} data-chat-redacted="">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-[color:var(--rs-text-muted)]">
        <span className="break-words font-semibold text-[color:var(--rs-text-secondary)] [overflow-wrap:anywhere]">
          {senderName}
        </span>
        <time dateTime={sentAt}>{formatTime(sentAt)}</time>
      </p>
      <p className="text-sm italic text-[color:var(--rs-text-muted)]">
        Message hidden — blocked player
      </p>
    </li>
  );
}

/** A compact action button for the message-actions row. */
export function MessageActionButton({
  children,
  danger = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      className={`rs-focus min-h-9 border px-3 py-1 text-xs font-semibold outline-none disabled:opacity-60 ${danger ? "border-[color:var(--rs-accent-danger)] text-[color:var(--rs-accent-danger)] hover:bg-[color:var(--rs-accent-danger-subtle)]" : "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-primary)] hover:border-[color:var(--rs-accent-secondary)]"}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
