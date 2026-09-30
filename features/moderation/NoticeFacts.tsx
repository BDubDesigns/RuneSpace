import Link from "next/link";
import type { ReactNode } from "react";
import type { SanctionNoticeView } from "@/game/schemas/moderation";
import {
  appealStatusLabel,
  formatNoticeInstant,
  noticeEndsLabel,
  noticeStateLabel,
} from "./notice-format";

/**
 * The facts of one sanction notice (issue #248), as one labelled list: the
 * rule, what it affects, how long, when, where it stands, and the appeal. Used
 * by the notices list and the notice page so both read identically. It shows
 * only what `SanctionNoticeView` carries — never who reported or reviewed it.
 */
export function NoticeFacts({ notice }: { notice: SanctionNoticeView }) {
  const ends = noticeEndsLabel(notice);
  return (
    <dl className="mt-3 space-y-2 text-sm" data-notice-facts="">
      <Fact label="Rule">
        <span className="block">{notice.ruleLabel}</span>
        <Link
          className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center text-[color:var(--rs-accent-primary)] underline underline-offset-2"
          href={notice.rulesHref}
        >
          Read the Community Rules
        </Link>
      </Fact>
      <Fact label="What's affected">{notice.accessAffected}</Fact>
      <Fact label="Duration">{notice.durationLabel}</Fact>
      <Fact label="Started">{formatNoticeInstant(notice.startsAt)}</Fact>
      {ends ? <Fact label="Ends">{ends}</Fact> : null}
      <Fact label="Status">{noticeStateLabel(notice.state)}</Fact>
      <Fact label="Appeal">{appealStatusLabel(notice.appeal)}</Fact>
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        {label}
      </dt>
      <dd className="break-words text-[color:var(--rs-text-secondary)]">{children}</dd>
    </div>
  );
}
