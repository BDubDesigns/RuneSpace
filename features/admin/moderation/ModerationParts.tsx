import type { ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { MODERATION_CASE_STATUS_LABEL, type ModerationCaseStatus } from "@/game/domain/moderation";
import type { PreservedMessageView } from "@/game/schemas/moderation";
import { formatOperatorTime } from "../admin-format";

/**
 * Small presentational pieces shared by the moderation pages (issue #248).
 * Server-safe: no hooks, so both server pages and client sections use them.
 */

export const controlClass =
  "mt-1 block w-full min-h-[var(--rs-touch-target)] border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)] rs-focus disabled:cursor-not-allowed disabled:opacity-50";

/** A titled case section; the heading is the section's accessible name. */
export function ModerationSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <Panel as="section" aria-labelledby={id} className="min-w-0 p-4" tone="raised">
      <h2
        className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]"
        id={id}
      >
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm">{children}</div>
    </Panel>
  );
}

/** A deterministic UTC time; the exact ISO instant is the hover/AT title. */
export function ModerationTime({ value }: { value: string | null }) {
  if (!value) return <span className="text-[color:var(--rs-text-muted)]">—</span>;
  return (
    <time className="font-mono text-xs tabular-nums" dateTime={value} title={value}>
      {formatOperatorTime(value)}
    </time>
  );
}

/** A monospace id that wraps instead of overflowing a phone screen. */
export function Id({ value }: { value: string }) {
  return <span className="break-all font-mono text-[11px]">{value}</span>;
}

const STATUS_TONE: Record<ModerationCaseStatus, string> = {
  open: "border-[color:var(--rs-accent-mining)] text-[color:var(--rs-accent-mining)]",
  reviewed: "border-[color:var(--rs-accent-primary)] text-[color:var(--rs-accent-primary)]",
  actioned: "border-[color:var(--rs-accent-danger)] text-[color:var(--rs-accent-danger)]",
  dismissed: "border-[color:var(--rs-border-structural)] text-[color:var(--rs-text-muted)]",
};

/** A case status as a labelled chip (text carries the meaning, colour only reinforces). */
export function StatusBadge({ status }: { status: ModerationCaseStatus }) {
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STATUS_TONE[status]}`}
    >
      {MODERATION_CASE_STATUS_LABEL[status]}
    </span>
  );
}

/** A label/value pair inside a `<dl>`. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-[color:var(--rs-text-primary)]">{children}</dd>
    </div>
  );
}

/** One preserved chat line: sender name at send, time, channel, and body. */
export function PreservedMessageRow({
  message,
  highlight = false,
}: {
  message: PreservedMessageView;
  /** The reported message itself, marked so it stands out from its context. */
  highlight?: boolean;
}) {
  return (
    <div
      className={`min-w-0 border px-3 py-2 ${
        highlight
          ? "border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-accent-danger-subtle)]"
          : "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)]"
      }`}
      data-reported-message={highlight ? "" : undefined}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span className="font-semibold text-[color:var(--rs-text-primary)]">
          {message.senderCharacterName}
        </span>
        <ModerationTime value={message.sentAt} />
        <span className="text-[color:var(--rs-text-muted)]">{message.channel}</span>
        {message.promoted ? (
          <span className="border border-[color:var(--rs-chat-promoted-border)] px-1.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--rs-chat-promoted-border)]">
            Promoted ad
          </span>
        ) : null}
        {highlight ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--rs-accent-danger)]">
            Reported message
          </span>
        ) : null}
      </div>
      <p
        className={`mt-1 whitespace-pre-wrap break-words text-[color:var(--rs-text-primary)] ${
          highlight ? "text-base" : "text-sm"
        }`}
      >
        {message.body}
      </p>
    </div>
  );
}
