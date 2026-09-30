"use client";

import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * One chat message in a log (General, Trade, or a Whisper conversation). Plain
 * text, wrapped anywhere so a long word never overflows. Another player's
 * message has an actions toggle; when expanded, the owning view's actions
 * (Whisper, Report, Block — issue #247) sit under the body.
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
}) {
  const actionsId = `chat-message-actions-${id}`;
  return (
    <li
      className={
        promoted
          ? "border border-[color:var(--rs-chat-promoted-border)] bg-[color:var(--rs-chat-promoted-surface)] px-3 py-2 [box-shadow:var(--rs-chat-promoted-glow)]"
          : "px-1"
      }
      data-chat-message={id}
      data-chat-promoted={promoted ? "" : undefined}
    >
      <div className="flex items-start gap-1">
        <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-xs text-[color:var(--rs-text-muted)]">
          <span
            className={`break-words font-semibold [overflow-wrap:anywhere] ${own ? "text-[color:var(--rs-accent-primary)]" : "text-[color:var(--rs-text-secondary)]"}`}
          >
            {senderName}
            {own ? <span className="sr-only"> (you)</span> : null}
          </span>
          {promoted ? (
            <span className="font-display uppercase tracking-[0.12em] text-[color:var(--rs-chat-promoted-border)]">
              Promoted ad
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
        {body}
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

/** A compact action button for the message-actions row. */
export function MessageActionButton({
  children,
  danger = false,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`rs-focus min-h-9 border px-3 py-1 text-xs font-semibold outline-none ${danger ? "border-[color:var(--rs-accent-danger)] text-[color:var(--rs-accent-danger)] hover:bg-[color:var(--rs-accent-danger-subtle)]" : "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-primary)] hover:border-[color:var(--rs-accent-secondary)]"}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
