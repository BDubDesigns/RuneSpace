"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { ActionLink } from "@/components/ui/ActionLink";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { reportClientDiagnostic } from "@/features/diagnostics/client";

export default function PlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [incidentId, setIncidentId] = useState<string>();
  useEffect(() => {
    setIncidentId(reportClientDiagnostic("play-boundary", error));
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center p-4">
      <Panel tone="raised">
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-danger)]">
          Terminal fault
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold">Mining console interrupted</h1>
        <Feedback tone="danger">
          Comms interruption. Mining status could not be confirmed. Your server-confirmed progress
          has not been changed here.
        </Feedback>
        {incidentId ? (
          <p className="mt-3 text-xs text-[color:var(--rs-text-muted)]">Incident {incidentId}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <ActionButton intent="mining" onClick={reset}>
            Retry connection
          </ActionButton>
          <ActionLink href="/characters" intent="secondary">
            Back to characters
          </ActionLink>
        </div>
      </Panel>
    </main>
  );
}
