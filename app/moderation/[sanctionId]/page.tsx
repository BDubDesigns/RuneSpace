import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { ActionLink } from "@/components/ui/ActionLink";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { AppealSection } from "@/features/moderation/AppealForm";
import { NoticeFacts } from "@/features/moderation/NoticeFacts";
import { NOTICE_LINK_CLASS } from "@/features/moderation/NoticeSummary";
import { noticeTitle } from "@/features/moderation/notice-format";
import { auth } from "@/server/auth";
import { loadSanctionNotice } from "@/server/moderation-notices";
import { ensurePlayerAccount, requireCurrentUser } from "@/server/ownership";

export const metadata = { title: "Moderation notice — RuneSpace" };

/**
 * One moderation notice and its appeal (issue #248). Account management: a
 * suspended player can open it and appeal. The notice is looked up through the
 * signed-in account only, so another account's sanction id is simply not found.
 */
export default async function ModerationNoticePage({
  params,
}: {
  params: Promise<{ sanctionId: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  const { sanctionId } = await params;
  const user = await requireCurrentUser(await headers());
  await ensurePlayerAccount(user.id);
  const notice = await loadSanctionNotice(user.id, sanctionId);
  if (!notice) notFound();

  return (
    <ScaffoldScreen>
      <SectionHeader eyebrow="Moderation notice">{noticeTitle(notice)}</SectionHeader>
      <NoticeFacts notice={notice} />
      <AppealSection notice={notice} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <Link className={NOTICE_LINK_CLASS} href="/moderation">
          All notices
        </Link>
        <ActionLink href="/characters" intent="secondary">
          Back to Characters
        </ActionLink>
      </div>
    </ScaffoldScreen>
  );
}
