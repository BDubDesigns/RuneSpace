"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { formatAuditSummary } from "./admin-format";

type AuditRow = {
  id: string;
  operation: string;
  targetIdentity: string | null;
  details: unknown;
  createdAt: Date | string;
  adminUserId: string;
};

/**
 * Immutable operator audit history for the selected character (Issue #113).
 * Read-only display; operators cannot modify or delete history.
 *
 * Each row leads with a concise, human-readable mutation summary derived from
 * the structured `details` the command boundaries persist (see
 * `formatAuditSummary`). The canonical operation id, operator id, exact target
 * identity, and authoritative timestamp remain available as secondary
 * forensic information, and the raw structured details sit behind a compact
 * disclosure rather than dominating the primary view.
 */

/**
 * Readable browser-local time. Local formatting is environment-dependent, so
 * it renders only after mount — the server pass renders the deterministic ISO
 * string, avoiding a hydration text mismatch. The exact ISO stays visible as a
 * secondary mono line so it remains accessible on touch (never hover-only).
 */
function AuditTimestamp({ value }: { value: Date | string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const iso = new Date(value).toISOString();
  const readable = mounted
    ? new Date(value).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : iso;
  return (
    <span
      className="shrink-0 text-left text-[color:var(--rs-text-muted)]"
      data-testid="admin-audit-time"
    >
      {readable}
      {mounted ? (
        <span className="block font-mono text-[10px] text-[color:var(--rs-text-muted)]">{iso}</span>
      ) : null}
    </span>
  );
}

export function AdminAuditTrail({ rows }: { rows: readonly AuditRow[] }) {
  return (
    <Panel className="p-4" tone="raised">
      <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        Operator audit history
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[color:var(--rs-text-muted)]">
          No operator mutations recorded for this character yet.
        </p>
      ) : (
        <ol className="mt-3 space-y-2" data-testid="admin-audit-list">
          {rows.map((row) => {
            const summary = formatAuditSummary(row.operation, row.details, row.targetIdentity);
            const hasDetails =
              row.details != null &&
              typeof row.details === "object" &&
              Object.keys(row.details).length > 0;
            return (
              <li
                key={row.id}
                className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[color:var(--rs-text-primary)]">{summary}</span>
                  <AuditTimestamp value={row.createdAt} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[color:var(--rs-text-muted)]">
                  <span data-testid="admin-audit-operation">op {row.operation}</span>
                  <span data-testid="admin-audit-operator">
                    operator{" "}
                    <span className="font-mono text-[10px] tabular-nums">{row.adminUserId}</span>
                  </span>
                  {row.targetIdentity ? (
                    <span className="min-w-0 break-all" data-testid="admin-audit-target">
                      target <span className="font-mono text-[10px]">{row.targetIdentity}</span>
                    </span>
                  ) : null}
                </div>
                {hasDetails ? (
                  <details className="mt-1 text-[color:var(--rs-text-muted)]">
                    <summary className="cursor-pointer underline decoration-dotted">
                      details
                    </summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-[color:var(--rs-border-structural)] p-2 font-mono text-[10px]">
                      {JSON.stringify(row.details, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
