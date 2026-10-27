"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel } from "@/components/ui/Panel";
import { ANALYTICS_CHOICE_EVENT } from "./analytics-policy";
import { analyticsOptedOut, analyticsStatus, setAnalyticsOptOut } from "./analytics-client";

/**
 * The player-facing analytics choice on Safety & Privacy (issue #413). The
 * choice is a first-party cookie, so it also applies to the server-side
 * character-creation event. A browser Global Privacy Control or Do Not Track
 * signal already turns analytics off and is reported rather than overridden.
 */
export function AnalyticsPrivacyControl() {
  const [state, setState] = useState<ReturnType<typeof analyticsStatus> | undefined>();
  const [optedOut, setOptedOut] = useState(false);

  useEffect(() => {
    const sync = () => {
      setState(analyticsStatus());
      setOptedOut(analyticsOptedOut());
    };
    sync();
    window.addEventListener(ANALYTICS_CHOICE_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_CHOICE_EVENT, sync);
  }, []);

  if (state === undefined) return null;

  let status: string;
  if (state === "privacy-signal") {
    status =
      "Your browser is sending a Global Privacy Control or Do Not Track signal, so analytics is off for you.";
  } else if (optedOut) {
    status = "Analytics is off in this browser.";
  } else if (state === "permitted") {
    status = "Analytics is on in this browser.";
  } else {
    status = "Analytics isn't running on this site, so there is nothing to turn off here.";
  }

  return (
    <Panel className="mt-8 max-w-3xl" tone="raised" data-testid="analytics-privacy-control">
      <h2 className="font-display text-lg font-bold tracking-tight text-[color:var(--rs-text-primary)]">
        Your analytics choice
      </h2>
      <p className="mt-2 text-sm leading-6 text-[color:var(--rs-text-secondary)]" role="status">
        {status}
      </p>
      <div className="mt-4">
        <ActionButton
          intent="secondary"
          onClick={() => setAnalyticsOptOut(!optedOut)}
          type="button"
        >
          {optedOut ? "Turn analytics on" : "Turn analytics off"}
        </ActionButton>
      </div>
    </Panel>
  );
}
