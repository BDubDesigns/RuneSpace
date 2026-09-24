"use client";

import { Panel } from "@/components/ui/Panel";
import type { AdminAccountAccessView } from "@/server/admin-access-state";
import { adminGrantEarlyAccess, adminRevokeEarlyAccess } from "@/server/admin-actions";
import { AdminAuditTrail } from "./AdminAuditTrail";
import { ConfirmAction } from "./ConfirmAction";

/**
 * Account access panel on the selected-character inspector (issue #223).
 *
 * The selected character already resolves its owning player account; Early
 * Access is granted to that WHOLE account (every character on it), never to
 * the character used to reach the inspector. Grant/revoke are server-
 * authoritative, admin-only, immediate at the request boundary, and audited
 * atomically; this panel only renders the returned authoritative view.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">{label}</dt>
      <dd className="min-w-0 break-all text-[color:var(--rs-text-primary)]">{children}</dd>
    </>
  );
}

export function AdminAccountAccessPanel({
  access,
  onChange,
  bus,
}: {
  access: AdminAccountAccessView;
  onChange: (next: AdminAccountAccessView) => void;
  bus: (message: string, tone: "success" | "danger" | "muted") => void;
}) {
  const { earlyAccess } = access;

  async function grant() {
    const result = await adminGrantEarlyAccess({ playerAccountId: access.playerAccountId });
    if ("error" in result) {
      bus(result.error, "danger");
      return;
    }
    onChange(result.view);
    bus(
      result.changed
        ? "Early Access granted to this account."
        : "This account already has Early Access; nothing changed.",
      result.changed ? "success" : "muted",
    );
  }

  async function revoke() {
    const result = await adminRevokeEarlyAccess({ playerAccountId: access.playerAccountId });
    if ("error" in result) {
      bus(result.error, "danger");
      return;
    }
    onChange(result.view);
    bus(
      result.changed
        ? "Early Access revoked for this account."
        : "This account does not have Early Access; nothing changed.",
      result.changed ? "success" : "muted",
    );
  }

  return (
    <div className="space-y-4">
      <Panel className="p-4" tone="raised" aria-labelledby="account-access-heading">
        <h2
          className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]"
          id="account-access-heading"
        >
          Account access
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Row label="Player account ID">
            <span className="font-mono text-xs">{access.playerAccountId}</span>
          </Row>
          <Row label="Email verification">{access.emailVerified ? "Verified" : "Not verified"}</Row>
          <Row label="Public gameplay">{access.publicGameplayOpen ? "Open" : "Closed"}</Row>
          <Row label="Early Access">{earlyAccess ? "Granted" : "Not granted"}</Row>
          <Row label="Granted at">
            {earlyAccess ? (
              <span className="font-mono text-xs">
                {new Date(earlyAccess.grantedAt).toISOString()}
              </span>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Granted by">
            {earlyAccess ? (
              <span className="font-mono text-xs">{earlyAccess.grantedByAdminUserId}</span>
            ) : (
              "—"
            )}
          </Row>
        </dl>
        {earlyAccess && access.publicGameplayOpen ? (
          <p className="mt-3 text-xs text-[color:var(--rs-text-muted)]">
            Public gameplay is open, so this grant is currently irrelevant. It is kept.
          </p>
        ) : null}
        <div className="mt-4">
          {earlyAccess ? (
            <ConfirmAction
              label="Revoke Early Access"
              confirmLabel="Revoke Early Access"
              title="Revoke Early Access for this account?"
              prompt="All characters on this RuneSpace account will lose early gameplay access. While public gameplay is closed, their next gameplay request returns them to Characters."
              onConfirm={revoke}
            />
          ) : (
            <ConfirmAction
              intent="secondary"
              label="Grant Early Access"
              confirmLabel="Grant Early Access"
              title="Grant Early Access to this account?"
              prompt="All characters on this RuneSpace account will be able to enter gameplay before public Soft Alpha opens."
              onConfirm={grant}
            />
          )}
        </div>
      </Panel>
      <AdminAuditTrail
        rows={access.audit}
        title="Account access history"
        emptyMessage="No Early Access changes recorded for this account yet."
        listTestId="admin-account-audit-list"
      />
    </div>
  );
}
