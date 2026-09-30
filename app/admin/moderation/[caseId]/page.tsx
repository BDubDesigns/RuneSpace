import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { AdminForbidden } from "@/features/admin/AdminForbidden";
import { CaseNotes } from "@/features/admin/moderation/CaseNotes";
import { CaseSanctions } from "@/features/admin/moderation/CaseSanctions";
import {
  BlocksSection,
  CaseHeaderFacts,
  CaseHistorySection,
  IdentitiesSection,
  NameHistorySection,
  PreservedContextSection,
  RecentReportsSection,
  ReportedContentSection,
  RetainedChatSection,
} from "@/features/admin/moderation/CaseSections";
import { CaseStatusControls } from "@/features/admin/moderation/CaseStatusControls";
import { ModerationSection } from "@/features/admin/moderation/ModerationParts";
import type { ModerationCaseView } from "@/game/schemas/moderation";
import { authorizeAdminPage } from "@/server/admin-auth";
import { loadModerationCase, ModerationCommandError } from "@/server/moderation-commands";

export const metadata = { title: "Moderation case — Operator Console" };

/**
 * One moderation case (issue #248). The admin allowlist gates the page and
 * loading it records a privileged-access audit row. Sections follow the
 * required review order: the reported content and its preserved context
 * first, then identities and safety context, then the operator's own notes,
 * sanctions, and the case history. Mutations are client controls that call
 * server actions and refresh this page.
 */
export default async function AdminModerationCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const auth = await authorizeAdminPage(await headers());
  if (!auth.authorized) {
    if (auth.reason === "unauthenticated") redirect("/sign-in");
    return <AdminForbidden />;
  }
  const { caseId } = await params;
  if (!z.string().uuid().safeParse(caseId).success) notFound();

  let view: ModerationCaseView;
  try {
    view = await loadModerationCase(await headers(), caseId);
  } catch (error) {
    if (error instanceof ModerationCommandError && error.status === 404) notFound();
    throw error;
  }

  return (
    <GameShell
      topBar={
        <TopBar
          title={<h1>{view.reference}</h1>}
          detail="Opening this case is recorded in the privileged access log."
          trailing={
            <ActionLink href="/admin/moderation" intent="secondary" className="px-3 py-1 text-xs">
              Queue
            </ActionLink>
          }
        />
      }
    >
      <div className="space-y-4">
        <ModerationSection id="case-header" title="Case">
          <CaseHeaderFacts view={view} />
          <CaseStatusControls caseId={view.caseId} status={view.status} />
        </ModerationSection>
        <ReportedContentSection reports={view.reports} />
        <PreservedContextSection reports={view.reports} />
        <IdentitiesSection subject={view.subject} reports={view.reports} />
        <RecentReportsSection signals={view.signals} />
        <BlocksSection signals={view.signals} reports={view.reports} />
        <RetainedChatSection caseId={view.caseId} reports={view.reports} />
        <NameHistorySection nameHistory={view.nameHistory} />
        <ModerationSection id="case-notes" title="Notes">
          <CaseNotes caseId={view.caseId} notes={view.notes} />
        </ModerationSection>
        <ModerationSection id="case-sanctions" title="Sanctions">
          <CaseSanctions caseId={view.caseId} sanctions={view.sanctions} />
        </ModerationSection>
        <CaseHistorySection audit={view.audit} />
      </div>
    </GameShell>
  );
}
