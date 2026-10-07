"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type { PlayGameplayState } from "@/server/play";

/**
 * Presentation pieces shared by the inspector's tabs (Issue #113, #333). Pure
 * layout and formatting; every authoritative value comes from the inspector's
 * snapshot, and every mutation lives in the tab that owns the state it changes.
 */

/** Props every tab that mutates the selected character receives. */
export type AdminTabProps = {
  characterId: string;
  characterName: string;
  play: PlayGameplayState;
  applyState: (state: PlayGameplayState) => void;
  refreshAll: () => Promise<void>;
  bus: (message: string, tone: "success" | "danger" | "muted") => void;
};

export const controlClass =
  "mt-1 block w-full border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-3 py-2 text-sm text-[color:var(--rs-text-primary)]";

export const listItemClass =
  "border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-sm";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-[color:var(--rs-text-primary)]">{children}</dd>
    </>
  );
}

/** A titled raised panel; the unit every tab is composed of. */
export function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Panel className="p-4" tone="raised" data-testid={testId}>
      <h2 className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </Panel>
  );
}

export function IsoTimestamp({ value }: { value?: string }) {
  // Browser-local readable time is environment-dependent, so it is only
  // rendered after mount: the server pass renders the deterministic ISO string
  // (no hydration text mismatch), then hydration swaps in the operator's local
  // time. The exact ISO remains visible as the authoritative secondary display.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!value) return <span className="text-[color:var(--rs-text-muted)]">—</span>;
  // Authoritative timestamps are already ISO strings ending in "Z"; never
  // append a second "Z".
  const shown = value.endsWith("Z") ? value : `${value}Z`;
  const readable = mounted
    ? new Date(shown).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : shown;
  return (
    <span className="text-[color:var(--rs-text-primary)]" title={shown}>
      {readable}
      {mounted ? (
        <span className="block font-mono text-[10px] text-[color:var(--rs-text-muted)]">
          {shown}
        </span>
      ) : null}
    </span>
  );
}
