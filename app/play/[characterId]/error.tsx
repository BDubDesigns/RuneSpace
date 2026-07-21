"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { ActionLink } from "@/components/ui/ActionLink";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { sanitizeDiagnosticText } from "@/game/schemas/diagnostics";

export function playBoundaryIncidentId(error: Error & { digest?: string }) {
  return typeof error.digest === "string" ? sanitizeDiagnosticText(error.digest, 100) : undefined;
}

export function reportPlayBoundaryDiagnostic(
  error: Error & { digest?: string },
  onAccepted: (incidentId: string) => void,
) {
  const digest = playBoundaryIncidentId(error);
  reportClientDiagnostic("play-boundary", error, digest ? {} : { onAccepted });
  return digest;
}

export default function PlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [incidentId, setIncidentId] = useState<string | undefined>(() =>
    playBoundaryIncidentId(error),
  );
  useEffect(() => {
    reportPlayBoundaryDiagnostic(error, setIncidentId);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center p-4">
      <Panel tone="raised">
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-danger)]">
          Terminal fault
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold">Play terminal interrupted</h1>
        <Feedback tone="danger">
          Comms interruption. The play terminal could not complete its last request.
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
