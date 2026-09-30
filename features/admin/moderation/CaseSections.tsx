import Link from "next/link";
import { REPORT_REASON_LABEL } from "@/game/domain/social-safety";
import type { CaseReportView, ModerationCaseView } from "@/game/schemas/moderation";
import { formatAuditSummary } from "../admin-format";
import {
  Field,
  Id,
  ModerationSection,
  ModerationTime,
  PreservedMessageRow,
  StatusBadge,
} from "./ModerationParts";
import { RetainedChatPanel } from "./RetainedChatPanel";

/**
 * The read-only sections of a moderation case, in the order the review
 * requires (issue #248): the reported content first, then the preserved
 * context, identities, and safety context. Server-rendered from one audited
 * `ModerationCaseView`; nothing here computes a score or a verdict.
 */

function reportTitle(report: CaseReportView, index: number, total: number): string {
  return `Report ${total - index} of ${total}: ${REPORT_REASON_LABEL[report.reason]}`;
}

export function ReportedContentSection({ reports }: { reports: CaseReportView[] }) {
  return (
    <ModerationSection id="case-reported-content" title="Reported content">
      {reports.length === 0 ? (
        <p className="text-[color:var(--rs-text-muted)]">
          No reports: this case was opened by an operator.
        </p>
      ) : (
        <ol className="space-y-3">
          {reports.map((report, index) => (
            <li
              key={report.reportId}
              className="min-w-0 space-y-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] p-3"
            >
              <h3 className="font-semibold text-[color:var(--rs-text-primary)]">
                {reportTitle(report, index, reports.length)}
              </h3>
              <p className="text-xs text-[color:var(--rs-text-muted)]">
                {report.kind === "message" ? "Message report" : "Player report"}
                {report.channel ? ` · ${report.channel}` : ""} ·{" "}
                <ModerationTime value={report.createdAt} />
              </p>
              {report.note ? (
                <p className="whitespace-pre-wrap break-words text-[color:var(--rs-text-secondary)]">
                  <span className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                    Reporter note:{" "}
                  </span>
                  {report.note}
                </p>
              ) : (
                <p className="text-xs text-[color:var(--rs-text-muted)]">No reporter note.</p>
              )}
              {report.evidence ? (
                <PreservedMessageRow highlight message={report.evidence.message} />
              ) : (
                <p className="text-xs text-[color:var(--rs-text-muted)]">
                  This report names a player, not a message.
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </ModerationSection>
  );
}

export function PreservedContextSection({ reports }: { reports: CaseReportView[] }) {
  const withEvidence = reports.filter((report) => report.evidence);
  return (
    <ModerationSection id="case-preserved-context" title="Preserved context">
      {withEvidence.length === 0 ? (
        <p className="text-[color:var(--rs-text-muted)]">
          No message evidence was preserved for this case.
        </p>
      ) : (
        <ol className="space-y-3">
          {reports.map((report, index) =>
            report.evidence ? (
              <li key={report.reportId} className="min-w-0 space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
                  {reportTitle(report, index, reports.length)}
                </h3>
                <ol className="space-y-1">
                  {report.evidence.before.map((message) => (
                    <li key={message.id}>
                      <PreservedMessageRow message={message} />
                    </li>
                  ))}
                  <li>
                    <PreservedMessageRow highlight message={report.evidence.message} />
                  </li>
                  {report.evidence.after.map((message) => (
                    <li key={message.id}>
                      <PreservedMessageRow message={message} />
                    </li>
                  ))}
                </ol>
              </li>
            ) : null,
          )}
        </ol>
      )}
    </ModerationSection>
  );
}

export function IdentitiesSection({
  subject,
  reports,
}: {
  subject: ModerationCaseView["subject"];
  reports: CaseReportView[];
}) {
  return (
    <ModerationSection id="case-identities" title="Identities">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
          Subject account
        </h3>
        <dl className="grid gap-2">
          <Field label="Player account ID">
            <Id value={subject.playerAccountId} />
          </Field>
          <Field label="Player name">{subject.playerName ?? "No Player name"}</Field>
          <Field label="Characters">
            <ul className="space-y-1">
              {subject.characters.map((character) => (
                <li key={character.characterId}>
                  {character.name} · slot {character.slot} · <Id value={character.characterId} />
                </li>
              ))}
            </ul>
          </Field>
        </dl>
      </div>
      {reports.map((report, index) => (
        <div
          key={report.reportId}
          className="min-w-0 space-y-1 border-t border-[color:var(--rs-border-structural)] pt-3"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
            {reportTitle(report, index, reports.length)}
          </h3>
          <dl className="grid gap-2">
            <Field label="Reporter">
              {report.reporter.playerName ?? "No Player name"} · {report.reporter.characterName}
              <br />
              account <Id value={report.reporter.playerAccountId} />
              <br />
              character <Id value={report.reporter.characterId} />
            </Field>
            <Field label="Reported character">
              {report.reported.nameAtReport} (name at report)
              <br />
              <Id value={report.reported.characterId} />
            </Field>
          </dl>
        </div>
      ))}
    </ModerationSection>
  );
}

export function RecentReportsSection({ signals }: { signals: ModerationCaseView["signals"] }) {
  return (
    <ModerationSection id="case-recent-reports" title="Recent reports against this account">
      <p className="text-[color:var(--rs-text-primary)]">
        {`${signals.reportsInWindow} ${signals.reportsInWindow === 1 ? "report" : "reports"} from ${signals.independentReportersInWindow} independent ${signals.independentReportersInWindow === 1 ? "account" : "accounts"} in the last ${signals.windowDays} days.`}
      </p>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
          Other cases on this account
        </h3>
        {signals.otherCases.length === 0 ? (
          <p className="mt-1 text-[color:var(--rs-text-muted)]">No other cases.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {signals.otherCases.map((other) => (
              <li key={other.caseId} className="flex flex-wrap items-center gap-2">
                <Link
                  className="rs-focus font-semibold text-[color:var(--rs-accent-primary)] underline"
                  href={`/admin/moderation/${other.caseId}`}
                >
                  {other.reference}
                </Link>
                <StatusBadge status={other.status} />
                <span className="text-xs text-[color:var(--rs-text-muted)]">
                  {other.reportCount} {other.reportCount === 1 ? "report" : "reports"} ·{" "}
                  <ModerationTime value={other.createdAt} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModerationSection>
  );
}

export function BlocksSection({
  signals,
  reports,
}: {
  signals: ModerationCaseView["signals"];
  reports: CaseReportView[];
}) {
  const accounts = (count: number) => (count === 1 ? "account" : "accounts");
  return (
    <ModerationSection id="case-blocks" title="Blocks">
      <ul className="space-y-1 text-[color:var(--rs-text-primary)]">
        <li>{`Blocked by ${signals.blockedByAccountsNow} ${accounts(signals.blockedByAccountsNow)} now.`}</li>
        <li>{`${signals.independentBlockersInWindow} independent ${accounts(signals.independentBlockersInWindow)} blocked this account in the last ${signals.windowDays} days.`}</li>
      </ul>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        These counts are context for review, not proof. There is no score.
      </p>
      {reports.length > 0 ? (
        <ul className="space-y-1">
          {reports.map((report, index) => (
            <li key={report.reportId} className="text-xs text-[color:var(--rs-text-secondary)]">
              {reportTitle(report, index, reports.length)}
              <br />
              <span className="text-sm text-[color:var(--rs-text-primary)]">
                {`Reporter blocks this account: ${report.reporterBlocksSubject ? "Yes" : "No"}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </ModerationSection>
  );
}

export function RetainedChatSection({
  caseId,
  reports,
}: {
  caseId: string;
  reports: CaseReportView[];
}) {
  return (
    <ModerationSection id="case-retained-chat" title="Retained chat">
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Nothing loads automatically. Each load is bounded to about 12 hours either side of the
        report.
      </p>
      {reports.length === 0 ? (
        <p className="text-[color:var(--rs-text-muted)]">No reports to centre a window on.</p>
      ) : (
        <ol className="space-y-3">
          {reports.map((report, index) => (
            <li
              key={report.reportId}
              className="min-w-0 space-y-2 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] p-3"
            >
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
                {reportTitle(report, index, reports.length)}
              </h3>
              <RetainedChatPanel caseId={caseId} reportId={report.reportId} />
            </li>
          ))}
        </ol>
      )}
    </ModerationSection>
  );
}

export function NameHistorySection({
  nameHistory,
}: {
  nameHistory: ModerationCaseView["nameHistory"];
}) {
  return (
    <ModerationSection id="case-name-history" title="Name history">
      {nameHistory.length === 0 ? (
        <p className="text-[color:var(--rs-text-muted)]">No names recorded.</p>
      ) : (
        <ul className="space-y-2">
          {nameHistory.map((entry) => (
            <li key={entry.characterId} className="min-w-0">
              <p className="text-[color:var(--rs-text-primary)]">
                Current name: {entry.currentName ?? "—"}
              </p>
              <p className="text-xs text-[color:var(--rs-text-muted)]">
                Seen as: {entry.seenAs.length > 0 ? entry.seenAs.join(", ") : "—"}
              </p>
              <p className="text-xs text-[color:var(--rs-text-muted)]">
                <Id value={entry.characterId} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </ModerationSection>
  );
}

export function CaseHistorySection({ audit }: { audit: ModerationCaseView["audit"] }) {
  return (
    <ModerationSection id="case-history" title="Case history">
      {audit.length === 0 ? (
        <p className="text-[color:var(--rs-text-muted)]">No operator actions recorded.</p>
      ) : (
        <ol aria-label="Case history entries" className="space-y-2">
          {audit.map((entry) => (
            <li
              key={entry.id}
              className="min-w-0 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-xs"
            >
              <p className="break-words text-[color:var(--rs-text-primary)]">
                {formatAuditSummary(entry.operation, entry.details, null)}
              </p>
              <p className="mt-1 text-[color:var(--rs-text-muted)]">
                <ModerationTime value={entry.createdAt} /> · operator{" "}
                <Id value={entry.adminUserId} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </ModerationSection>
  );
}

/** Header facts: status, who opened it, and when. The reference is the page title. */
export function CaseHeaderFacts({ view }: { view: ModerationCaseView }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={view.status} />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Opened by">
          {view.openedBy === "report" ? "Player report" : "Operator"}
          {view.openedByAdminUserId ? (
            <>
              {" "}
              <Id value={view.openedByAdminUserId} />
            </>
          ) : null}
        </Field>
        <Field label="Created">
          <ModerationTime value={view.createdAt} />
        </Field>
        <Field label="Updated">
          <ModerationTime value={view.updatedAt} />
        </Field>
        {view.openingReason ? (
          <div className="col-span-2 min-w-0">
            <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
              Operator reason
            </dt>
            <dd className="whitespace-pre-wrap break-words text-[color:var(--rs-text-primary)]">
              {view.openingReason}
            </dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}
