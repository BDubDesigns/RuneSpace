"use client";

import { useState } from "react";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SoftAlphaCountdown } from "@/features/launch/SoftAlphaCountdown";
import { formatLaunchTargetPacific } from "@/game/domain/soft-alpha-launch";
import type { AdminPublicGameplayView } from "@/server/admin-access-state";
import { adminClosePublicGameplay, adminOpenPublicGameplay } from "@/server/admin-actions";
import { AdminAuditTrail } from "./AdminAuditTrail";
import { ConfirmAction } from "./ConfirmAction";

/**
 * The global PUBLIC GAMEPLAY panel on the Operator Console home (issue #223),
 * separate from the selected-account inspector.
 *
 * Public gameplay opens and closes only through these explicit, confirmed,
 * admin-only, audited commands. The launch target is fixed presentation: the
 * countdown reaching it shows LAUNCH IMMINENT! and never opens anything.
 */
export function AdminPublicGameplayPanel({ initial }: { initial: AdminPublicGameplayView }) {
  const [view, setView] = useState(initial);
  const [message, setMessage] = useState<{
    text: string;
    tone: "success" | "danger" | "muted";
  } | null>(null);

  async function run(command: typeof adminOpenPublicGameplay, changedText: string) {
    const result = await command();
    if ("error" in result) {
      setMessage({ text: result.error, tone: "danger" });
      return;
    }
    setView(result.view);
    setMessage(
      result.changed
        ? { text: changedText, tone: "success" }
        : { text: "Public gameplay was already in that state; nothing changed.", tone: "muted" },
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <Panel as="section" className="p-4" tone="raised" aria-labelledby="public-gameplay-heading">
        <h2
          className="font-display text-sm font-bold uppercase tracking-[0.16em] text-[color:var(--rs-text-primary)]"
          id="public-gameplay-heading"
        >
          PUBLIC GAMEPLAY
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            Launch target
          </dt>
          <dd className="font-semibold text-[color:var(--rs-text-primary)]">
            {formatLaunchTargetPacific(new Date(view.launchTargetAt))}
          </dd>
          <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
            Current state
          </dt>
          <dd
            className="font-semibold text-[color:var(--rs-text-primary)]"
            data-testid="public-gameplay-state"
          >
            {view.publicGameplayOpen ? "Open" : "Closed"}
          </dd>
        </dl>
        {view.publicGameplayOpen ? null : (
          <SoftAlphaCountdown
            className="mt-4"
            launchTargetAt={new Date(view.launchTargetAt).toISOString()}
            publicGameplayOpen={false}
            serverNow={new Date(view.serverNow).toISOString()}
          />
        )}
        <div className="mt-4">
          {view.publicGameplayOpen ? (
            <ConfirmAction
              label="Close Public Gameplay"
              confirmLabel="Close Public Gameplay"
              title="Close public gameplay?"
              prompt="New gameplay requests from ordinary accounts will be blocked. Accounts with Early Access remain able to play."
              onConfirm={() => run(adminClosePublicGameplay, "Public gameplay closed.")}
            />
          ) : (
            <ConfirmAction
              intent="secondary"
              label="Open Public Gameplay"
              confirmLabel="Open Public Gameplay"
              title="Open RuneSpace to everyone?"
              prompt="Verified accounts will immediately be able to enter gameplay. This does not bypass future moderation/suspension restrictions."
              onConfirm={() => run(adminOpenPublicGameplay, "Public gameplay opened.")}
            />
          )}
        </div>
        {message ? (
          <div className="mt-3">
            <Feedback tone={message.tone}>{message.text}</Feedback>
          </div>
        ) : null}
      </Panel>
      <AdminAuditTrail
        rows={view.audit}
        title="Public gameplay history"
        emptyMessage="No public gameplay changes recorded yet."
        listTestId="admin-system-audit-list"
      />
    </div>
  );
}
