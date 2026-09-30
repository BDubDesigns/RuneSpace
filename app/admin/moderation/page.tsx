import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { Panel } from "@/components/ui/Panel";
import { AdminForbidden } from "@/features/admin/AdminForbidden";
import { ModerationTime, StatusBadge } from "@/features/admin/moderation/ModerationParts";
import { REPORT_REASON_LABEL } from "@/game/domain/social-safety";
import {
  ModerationQueueFilterSchema,
  type ModerationQueueEntry,
  type ModerationQueueFilter,
  type ModerationQueueView,
} from "@/game/schemas/moderation";
import { authorizeAdminPage } from "@/server/admin-auth";
import { loadModerationQueue } from "@/server/moderation-commands";

export const metadata = { title: "Moderation queue — Operator Console" };

/**
 * Operator moderation queue (issue #248). Server-authoritative: the admin
 * allowlist gates the page, and loading the queue records a privileged-access
 * audit row. Entries are phone-friendly cards, oldest attention first as the
 * server orders them; `?filter=` selects the view and defaults to the cases
 * still needing review.
 */
export default async function AdminModerationQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const auth = await authorizeAdminPage(await headers());
  if (!auth.authorized) {
    if (auth.reason === "unauthenticated") redirect("/sign-in");
    return <AdminForbidden />;
  }
  const raw = (await searchParams).filter;
  const parsed = ModerationQueueFilterSchema.safeParse(Array.isArray(raw) ? raw[0] : raw);
  const filter: ModerationQueueFilter = parsed.success ? parsed.data : "active";
  const queue = await loadModerationQueue(await headers(), filter);

  return (
    <GameShell
      topBar={
        <TopBar
          title="Moderation queue"
          detail="Opening this page is recorded in the privileged access log."
          trailing={
            <ActionLink href="/admin" intent="secondary" className="px-3 py-1 text-xs">
              Console
            </ActionLink>
          }
        />
      }
    >
      <div className="space-y-4">
        <QueueFilters queue={queue} />
        {queue.entries.length === 0 ? (
          <Panel className="p-4" tone="raised">
            <p className="text-sm text-[color:var(--rs-text-muted)]">No cases match this filter.</p>
          </Panel>
        ) : (
          <ul aria-label="Moderation cases" className="space-y-3">
            {queue.entries.map((entry) => (
              <QueueCard key={entry.caseId} entry={entry} />
            ))}
          </ul>
        )}
      </div>
    </GameShell>
  );
}

const FILTERS: { filter: ModerationQueueFilter; label: string }[] = [
  { filter: "active", label: "Needs review" },
  { filter: "appeals", label: "Appeals" },
  { filter: "open", label: "Open" },
  { filter: "reviewed", label: "Reviewed" },
  { filter: "actioned", label: "Actioned" },
  { filter: "dismissed", label: "Dismissed" },
];

function filterCount(queue: ModerationQueueView, filter: ModerationQueueFilter): number {
  if (filter === "active") return queue.counts.open + queue.counts.reviewed;
  if (filter === "appeals") return queue.pendingAppealCases;
  return queue.counts[filter];
}

/** Filter links with live counts; the current one carries `aria-current`. */
function QueueFilters({ queue }: { queue: ModerationQueueView }) {
  return (
    <nav aria-label="Queue filters">
      <ul className="flex flex-wrap gap-2">
        {FILTERS.map(({ filter, label }) => {
          const current = filter === queue.filter;
          return (
            <li key={filter}>
              <Link
                aria-current={current ? "page" : undefined}
                className={`rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center gap-2 border px-3 py-2 text-sm font-semibold ${
                  current
                    ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] text-[color:var(--rs-accent-primary)]"
                    : "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] text-[color:var(--rs-text-primary)]"
                }`}
                href={
                  filter === "active" ? "/admin/moderation" : `/admin/moderation?filter=${filter}`
                }
              >
                {label}
                <span className="font-mono text-xs tabular-nums">{filterCount(queue, filter)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** One case as a card; the reference is a stretched link to the case. */
function QueueCard({ entry }: { entry: ModerationQueueEntry }) {
  const { subject } = entry;
  const reasons = entry.reasons.map((reason) => REPORT_REASON_LABEL[reason]);
  return (
    <Panel as="li" className="relative min-w-0 p-4" tone="raised">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-bold text-[color:var(--rs-text-primary)]">
          <Link
            className="rs-focus after:absolute after:inset-0 after:content-['']"
            href={`/admin/moderation/${entry.caseId}`}
          >
            {entry.reference}
          </Link>
        </h2>
        <StatusBadge status={entry.status} />
        {entry.pendingAppeals > 0 ? (
          <span className="border border-[color:var(--rs-accent-arcane)] bg-[color:var(--rs-accent-arcane-subtle)] px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-accent-arcane)]">
            Appeal pending
          </span>
        ) : null}
      </div>
      <p className="mt-2 break-words text-sm text-[color:var(--rs-text-primary)]">
        {/* The case's subject, never the reporter: reporters are in the case's Identities. */}
        <span className="text-[color:var(--rs-text-muted)]">Reported account: </span>
        {subject.playerName ?? "Unnamed player"}
        <span className="text-[color:var(--rs-text-muted)]">
          {" · "}
          {subject.characters.length > 0
            ? subject.characters.map((character) => character.name).join(", ")
            : "no characters"}
        </span>
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div>
          <dt className="uppercase tracking-wide text-[color:var(--rs-text-muted)]">Reports</dt>
          <dd className="text-[color:var(--rs-text-primary)]">{entry.reportCount}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-[color:var(--rs-text-muted)]">Opened by</dt>
          <dd className="text-[color:var(--rs-text-primary)]">
            {entry.openedBy === "report" ? "Player report" : "Operator"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase tracking-wide text-[color:var(--rs-text-muted)]">Reasons</dt>
          <dd className="text-[color:var(--rs-text-primary)]">
            {reasons.length > 0 ? reasons.join(", ") : "—"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            Latest report
          </dt>
          <dd>
            <ModerationTime value={entry.latestReportAt} />
          </dd>
        </div>
      </dl>
    </Panel>
  );
}
