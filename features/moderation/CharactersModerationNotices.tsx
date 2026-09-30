import Link from "next/link";
import type { SanctionNoticeView } from "@/game/schemas/moderation";
import { NOTICE_LINK_CLASS, NoticeSummary } from "./NoticeSummary";
import { noticeEdgeColor } from "./notice-format";

/** Most severe first, so a suspension is the primary message. */
const SEVERITY: Record<SanctionNoticeView["kind"], number> = {
  suspension: 0,
  social_restriction: 1,
  warning: 2,
};

/**
 * The Characters page's moderation callouts (issue #248): one prominent
 * "Moderation notice" per current notice, most severe first, each linking to
 * its notice and appeal. While the account is suspended the suspension notice
 * is the page's primary message. `suspended` comes from the server's
 * authoritative gameplay-access decision; this only renders it. If a
 * suspension is in effect but its notice is not in the list (it should always
 * be), a plain message still says so and points at the notices page.
 */
export function CharactersModerationNotices({
  notices,
  suspended,
}: {
  notices: readonly SanctionNoticeView[];
  suspended: boolean;
}) {
  const current = notices
    .filter((notice) => notice.current)
    .sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind]);
  const showsSuspension = current.some((notice) => notice.kind === "suspension");
  if (current.length === 0 && !suspended) return null;
  return (
    <section
      aria-label="Moderation notices"
      className="mt-4 space-y-3"
      data-characters-moderation=""
    >
      {suspended && !showsSuspension ? (
        <div
          className="border border-l-4 bg-[color:var(--rs-surface-raised)] p-3 text-sm"
          style={{ borderColor: noticeEdgeColor("suspension") }}
        >
          <h2 className="font-display text-sm font-bold uppercase tracking-[0.12em] text-[color:var(--rs-accent-danger)]">
            Moderation notice
          </h2>
          <p className="mt-1 text-[color:var(--rs-text-secondary)]">
            Your account is suspended. You can&apos;t play right now.
          </p>
          <Link className={NOTICE_LINK_CLASS} href="/moderation">
            View notice and appeal
          </Link>
        </div>
      ) : null}
      {current.map((notice) => (
        <NoticeSummary
          actions={
            <Link className={NOTICE_LINK_CLASS} href={`/moderation/${notice.sanctionId}`}>
              View notice and appeal
            </Link>
          }
          headingLevel={2}
          key={notice.sanctionId}
          lead={
            notice.kind === "suspension"
              ? "Your account is suspended. You can't play right now, but you can read the notice and appeal it."
              : undefined
          }
          notice={notice}
        />
      ))}
    </section>
  );
}
