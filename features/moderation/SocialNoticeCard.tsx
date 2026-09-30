import type { SanctionNoticeView } from "@/game/schemas/moderation";
import { NOTICE_LINK_CLASS, NoticeSummary } from "./NoticeSummary";

/**
 * A current moderation notice as a pinned Chat/Social card (issue #248). Its
 * links open in a new tab so the player keeps their place in Play. A
 * suspension can never be current here — the Play stream refuses a suspended
 * account — so this only ever shows a social restriction or a recent warning.
 */
export function SocialNoticeCard({ notice }: { notice: SanctionNoticeView }) {
  return (
    <NoticeSummary
      actions={
        <>
          <a
            className={NOTICE_LINK_CLASS}
            href={`/moderation/${notice.sanctionId}`}
            rel="noreferrer"
            target="_blank"
          >
            Details and appeal
          </a>
          <a className={NOTICE_LINK_CLASS} href={notice.rulesHref} rel="noreferrer" target="_blank">
            Community Rules
          </a>
        </>
      }
      headingLevel={3}
      notice={notice}
    />
  );
}
