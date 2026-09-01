"use client";

import { Panel } from "@/components/ui/Panel";

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
 */
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
          {rows.map((row) => (
            <li
              key={row.id}
              className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-xs"
            >
              <div className="flex justify-between gap-2 text-[color:var(--rs-text-primary)]">
                <span className="font-medium">{row.operation}</span>
                <span className="shrink-0 text-[color:var(--rs-text-muted)]">
                  {new Date(row.createdAt).toISOString()}
                </span>
              </div>
              <div className="mt-1 truncate text-[color:var(--rs-text-muted)]">
                operator {row.adminUserId.slice(0, 8)}
                {row.targetIdentity ? ` · ${row.targetIdentity}` : ""}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
