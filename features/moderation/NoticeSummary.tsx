import type { ReactNode } from "react";
import type { SanctionNoticeView } from "@/game/schemas/moderation";
import { noticeEdgeColor, noticeEndsLabel, noticeTitle } from "./notice-format";

/**
 * A compact "you have a moderation notice" block (issue #248) for surfaces
 * where the notice is a heads-up rather than the page: the Characters callout
 * and the Chat/Social pinned card. Colour sits on the edge and the label; the
 * interior stays neutral. `actions` are the surface's own links.
 */
export function NoticeSummary({
  notice,
  headingLevel,
  lead,
  actions,
}: {
  notice: SanctionNoticeView;
  headingLevel: 2 | 3;
  /** An optional plain sentence above the facts (for example a suspension message). */
  lead?: ReactNode;
  actions: ReactNode;
}) {
  const Heading = `h${headingLevel}` as const;
  const ends = noticeEndsLabel(notice);
  return (
    <div
      className="border border-l-4 bg-[color:var(--rs-surface-raised)] p-3 text-sm"
      data-moderation-notice={notice.sanctionId}
      style={{ borderColor: noticeEdgeColor(notice.kind) }}
    >
      <Heading
        className="font-display text-sm font-bold uppercase tracking-[0.12em]"
        style={{ color: noticeEdgeColor(notice.kind) }}
      >
        Moderation notice
      </Heading>
      <p className="mt-1 break-words font-medium text-[color:var(--rs-text-primary)]">
        {noticeTitle(notice)}
      </p>
      {lead ? <div className="mt-1 text-[color:var(--rs-text-secondary)]">{lead}</div> : null}
      <dl className="mt-2 space-y-1 text-[color:var(--rs-text-secondary)]">
        <div>
          <dt className="inline text-[color:var(--rs-text-muted)]">Rule: </dt>
          <dd className="inline break-words">{notice.ruleLabel}</dd>
        </div>
        <div>
          <dt className="inline text-[color:var(--rs-text-muted)]">What&apos;s affected: </dt>
          <dd className="inline break-words">{notice.accessAffected}</dd>
        </div>
        <div>
          <dt className="inline text-[color:var(--rs-text-muted)]">Duration: </dt>
          <dd className="inline">{notice.durationLabel}</dd>
        </div>
        {ends ? (
          <div>
            <dt className="sr-only">Ends</dt>
            <dd>{ends}</dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">{actions}</div>
    </div>
  );
}

/** The inline text-link treatment shared by notice actions. */
export const NOTICE_LINK_CLASS =
  "rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-[color:var(--rs-accent-primary)] underline underline-offset-2";
