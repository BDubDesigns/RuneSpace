"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel } from "@/components/ui/Panel";
import { ANALYTICS_CHOICE_EVENT } from "./analytics-policy";
import { analyticsStatus, setAnalyticsChoice, type AnalyticsPermission } from "./analytics-client";

/**
 * The player-facing analytics choice on Safety & Privacy (issue #413). The
 * choice is a first-party cookie, so it also applies to the server-side
 * character-creation event. A browser Global Privacy Control or Do Not Track
 * signal already turns analytics off and is reported rather than overridden.
 */
export function AnalyticsPrivacyControl() {
  const [state, setState] = useState<AnalyticsPermission | undefined>();

  useEffect(() => {
    const sync = () => setState(analyticsStatus());
    sync();
    window.addEventListener(ANALYTICS_CHOICE_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_CHOICE_EVENT, sync);
  }, []);

  if (state === undefined) return null;

  const on = state === "permitted";
  const messages: Record<AnalyticsPermission, string> = {
    permitted: "Analytics is on in this browser.",
    declined: "Analytics is off in this browser.",
    "needs-consent": "You haven't chosen yet, so analytics is off.",
    "privacy-signal":
      "Your browser is sending a Global Privacy Control or Do Not Track signal, so analytics is off for you.",
    "wrong-host":
      "Analytics isn't running on this site, so there is nothing to turn on or off here.",
    unconfigured:
      "Analytics isn't running on this site, so there is nothing to turn on or off here.",
  };

  return (
    <Panel className="mt-8 max-w-3xl" tone="raised" data-testid="analytics-privacy-control">
      <h2 className="font-display text-lg font-bold tracking-tight text-[color:var(--rs-text-primary)]">
        Your analytics choice
      </h2>
      <p className="mt-2 text-sm leading-6 text-[color:var(--rs-text-secondary)]" role="status">
        {messages[state]}
      </p>
      <div className="mt-4">
        <ActionButton
          intent="secondary"
          onClick={() => setAnalyticsChoice(on ? "off" : "on")}
          type="button"
        >
          {on ? "Turn analytics off" : "Turn analytics on"}
        </ActionButton>
      </div>
    </Panel>
  );
}
