import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/ActionLink";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { Panel } from "@/components/ui/Panel";
import { AdminForbidden } from "@/features/admin/AdminForbidden";
import { Id, ModerationTime } from "@/features/admin/moderation/ModerationParts";
import { PRIVILEGED_ACCESS_LABEL } from "@/game/domain/moderation";
import { authorizeAdminPage } from "@/server/admin-auth";
import { loadPrivilegedAccessLogView } from "@/server/moderation-commands";

export const metadata = { title: "Privileged access log — Operator Console" };

/**
 * The immutable log of every privileged view of reports, evidence, retained
 * chat, and moderation history (issue #248). Newest first, capped at the
 * latest 200. Viewing it is itself recorded in the log.
 */
export default async function AdminPrivilegedAccessLogPage() {
  const auth = await authorizeAdminPage(await headers());
  if (!auth.authorized) {
    if (auth.reason === "unauthenticated") redirect("/sign-in");
    return <AdminForbidden />;
  }
  const entries = await loadPrivilegedAccessLogView(await headers(), 200);

  return (
    <GameShell
      topBar={
        <TopBar
          title="Privileged access log"
          detail="Newest first, latest 200 entries. Viewing this log is itself recorded."
          trailing={
            <ActionLink href="/admin/moderation" intent="secondary" className="px-3 py-1 text-xs">
              Queue
            </ActionLink>
          }
        />
      }
    >
      {entries.length === 0 ? (
        <Panel className="p-4" tone="raised">
          <p className="text-sm text-[color:var(--rs-text-muted)]">
            No privileged access recorded.
          </p>
        </Panel>
      ) : (
        <ol aria-label="Privileged access entries" className="space-y-2">
          {entries.map((entry) => (
            <Panel as="li" className="min-w-0 p-3" key={entry.id} tone="raised">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-[color:var(--rs-text-primary)]">
                  {PRIVILEGED_ACCESS_LABEL[entry.kind]}
                </span>
                <ModerationTime value={entry.createdAt} />
              </div>
              <dl className="mt-2 grid gap-1 text-xs">
                <div className="min-w-0">
                  <dt className="inline text-[color:var(--rs-text-muted)]">Operator </dt>
                  <dd className="inline">
                    <Id value={entry.adminUserId} />
                  </dd>
                </div>
                {entry.caseId && entry.caseReference ? (
                  <div>
                    <dt className="inline text-[color:var(--rs-text-muted)]">Case </dt>
                    <dd className="inline">
                      <Link
                        className="rs-focus font-semibold text-[color:var(--rs-accent-primary)] underline"
                        href={`/admin/moderation/${entry.caseId}`}
                      >
                        {entry.caseReference}
                      </Link>
                    </dd>
                  </div>
                ) : null}
                {entry.targetPlayerAccountId ? (
                  <div className="min-w-0">
                    <dt className="inline text-[color:var(--rs-text-muted)]">Target account </dt>
                    <dd className="inline">
                      <Id value={entry.targetPlayerAccountId} />
                    </dd>
                  </div>
                ) : null}
                {entry.targetCharacterId ? (
                  <div className="min-w-0">
                    <dt className="inline text-[color:var(--rs-text-muted)]">Target character </dt>
                    <dd className="inline">
                      <Id value={entry.targetCharacterId} />
                    </dd>
                  </div>
                ) : null}
              </dl>
              {Object.keys(entry.context).length > 0 ? (
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded border border-[color:var(--rs-border-structural)] p-2 font-mono text-[10px] text-[color:var(--rs-text-muted)]">
                  {JSON.stringify(entry.context)}
                </pre>
              ) : null}
            </Panel>
          ))}
        </ol>
      )}
    </GameShell>
  );
}
