"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel } from "@/components/ui/Panel";
import { ANALYTICS_CHOICE_EVENT } from "./analytics-policy";
import { analyticsStatus, setAnalyticsChoice, type AnalyticsPermission } from "./analytics-client";

/**
 * The player-facing PostHog choice on Safety & Privacy (issue #413). It governs
 * only the optional PostHog analytics; the anonymous daily visit counts have
 * their own control (`VisitCountControl`, issue #425). The
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
    permitted: "PostHog analytics is on in this browser.",
    declined: "PostHog analytics is off in this browser.",
    "needs-consent": "You haven't chosen yet, so PostHog analytics is off.",
    "privacy-signal":
      "Your browser is sending a Global Privacy Control or Do Not Track signal, so PostHog analytics is off for you.",
    "wrong-host":
      "PostHog analytics isn't running on this site, so there is nothing to turn on or off here.",
    unconfigured:
      "PostHog analytics isn't running on this site, so there is nothing to turn on or off here.",
  };

  return (
    <Panel className="mt-8 max-w-3xl" tone="raised" data-testid="analytics-privacy-control">
      <h2 className="font-display text-lg font-bold tracking-tight text-[color:var(--rs-text-primary)]">
        Your PostHog analytics choice
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
          {on ? "Turn PostHog analytics off" : "Turn PostHog analytics on"}
        </ActionButton>
      </div>
    </Panel>
  );
}
