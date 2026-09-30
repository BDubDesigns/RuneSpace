import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { NoticeFacts } from "@/features/moderation/NoticeFacts";
import { NOTICE_LINK_CLASS } from "@/features/moderation/NoticeSummary";
import { noticeEdgeColor, noticeTitle } from "@/features/moderation/notice-format";
import { COMMUNITY_RULES_PATH, SAFETY_PRIVACY_PATH } from "@/features/public-site/policy-links";
import { auth } from "@/server/auth";
import { loadSanctionNotices } from "@/server/moderation-notices";
import { ensurePlayerAccount, requireCurrentUser } from "@/server/ownership";

export const metadata = { title: "Moderation notices — RuneSpace" };

/**
 * The player's own moderation notices (issue #248).
 *
 * Account management, not gameplay: a session is all it needs, so a suspended
 * player can read every notice and appeal from here. Loaded fresh for this
 * request and scoped to the signed-in account. A notice states the rule, what
 * it affects, how long, and where the appeal stands — never who reported or
 * reviewed it.
 */
export default async function ModerationNoticesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  const user = await requireCurrentUser(await headers());
  await ensurePlayerAccount(user.id);
  const { notices } = await loadSanctionNotices(user.id);

  return (
    <ScaffoldScreen>
      <SectionHeader eyebrow="Your account">Moderation notices</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Read the{" "}
        <Link
          className="rs-focus text-[color:var(--rs-accent-primary)] underline"
          href={COMMUNITY_RULES_PATH}
        >
          Community Rules
        </Link>{" "}
        and the{" "}
        <Link
          className="rs-focus text-[color:var(--rs-accent-primary)] underline"
          href={SAFETY_PRIVACY_PATH}
        >
          Safety &amp; Privacy
        </Link>{" "}
        page to see how RuneSpace keeps chat safe.
      </p>
      {notices.length === 0 ? (
        <p className="mt-6 text-sm text-[color:var(--rs-text-muted)]" data-moderation-empty="">
          You don&apos;t have any moderation notices.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {notices.map((notice) => (
            <Panel
              as="li"
              className="border-l-4 !p-4"
              data-moderation-notice={notice.sanctionId}
              key={notice.sanctionId}
              style={{ borderLeftColor: noticeEdgeColor(notice.kind) }}
              tone="raised"
            >
              <h2 className="break-words font-display text-base font-bold text-[color:var(--rs-text-primary)]">
                {noticeTitle(notice)}
              </h2>
              <NoticeFacts notice={notice} />
              <Link
                className={`${NOTICE_LINK_CLASS} mt-1`}
                href={`/moderation/${notice.sanctionId}`}
              >
                {notice.appealable ? "Details and appeal" : "Details"}
              </Link>
            </Panel>
          ))}
        </ul>
      )}
      <ActionLink className="mt-6 flex w-full" href="/characters" intent="secondary">
        Back to Characters
      </ActionLink>
    </ScaffoldScreen>
  );
}
