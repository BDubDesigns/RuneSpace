"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel } from "@/components/ui/Panel";
import { browserPrivacySignal } from "./analytics-client";
import {
  hasStatsOptOut,
  STATS_OPTOUT_EVENT,
  statsOptOutCookie,
  VISIT_COUNT_SETTINGS_ID,
} from "./referral-counts";

type VisitCountState = "counted" | "objected" | "privacy-signal";

const MESSAGES: Record<VisitCountState, string> = {
  counted:
    "Your visits are included in RuneSpace's anonymous daily page-load totals. Press the button and they won't be.",
  objected: "Your visits aren't counted in the daily totals in this browser.",
  "privacy-signal":
    "Your browser is sending a Global Privacy Control or Do Not Track signal, so your visits aren't counted.",
};

function readState(): VisitCountState {
  if (browserPrivacySignal()) return "privacy-signal";
  return hasStatsOptOut(document.cookie) ? "objected" : "counted";
}

/**
 * The visit-count objection on Safety & Privacy (issue #425). It is its own
 * choice, separate from PostHog: it only sets or clears `rs_stats_optout`,
 * which the server checks before it increments a daily total. It is a real
 * form, so it works without JavaScript (the POST route answers with a
 * confirmation page); with JavaScript it saves in place and announces the
 * result. The server-rendered state is "counted", the default, and the page
 * corrects it from the cookie and the browser's signals once it hydrates.
 */
export function VisitCountControl() {
  const [state, setState] = useState<VisitCountState>("counted");

  useEffect(() => {
    const sync = () => setState(readState());
    sync();
    window.addEventListener(STATS_OPTOUT_EVENT, sync);
    return () => window.removeEventListener(STATS_OPTOUT_EVENT, sync);
  }, []);

  const counting = state === "counted";

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      document.cookie = statsOptOutCookie(!counting, window.location.protocol === "https:");
      window.dispatchEvent(new Event(STATS_OPTOUT_EVENT));
    } catch {
      // A blocked cookie: let the form post to the server instead.
      event.currentTarget.submit();
    }
  }

  return (
    <Panel
      className="mt-8 max-w-3xl"
      data-testid="visit-count-control"
      id={VISIT_COUNT_SETTINGS_ID}
      tone="raised"
    >
      <h2 className="font-display text-lg font-bold tracking-tight text-[color:var(--rs-text-primary)]">
        Do not count my visits
      </h2>
      <p className="mt-2 text-sm leading-6 text-[color:var(--rs-text-secondary)]">
        This only affects RuneSpace&apos;s anonymous daily visit totals. It is separate from the
        PostHog choice on this page, and either one can be on or off without the other.
      </p>
      <p
        className="mt-2 text-sm leading-6 text-[color:var(--rs-text-secondary)]"
        data-testid="visit-count-status"
        role="status"
      >
        {MESSAGES[state]}
      </p>
      <form action="/api/visit-count-preference" className="mt-4" method="post" onSubmit={save}>
        <input name="choice" type="hidden" value={counting ? "off" : "on"} />
        <ActionButton intent="secondary" type="submit">
          {counting ? "Do not count my visits" : "Count my visits again"}
        </ActionButton>
      </form>
      {/* Without JavaScript the page cannot know the saved state, so it also offers the undo. */}
      <noscript>
        <form action="/api/visit-count-preference" className="mt-3" method="post">
          <input name="choice" type="hidden" value="on" />
          <ActionButton intent="secondary" type="submit">
            Count my visits again
          </ActionButton>
        </form>
      </noscript>
    </Panel>
  );
}
