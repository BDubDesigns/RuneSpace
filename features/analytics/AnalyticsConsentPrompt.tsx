"use client";

import { usePathname } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { TextLink } from "@/components/ui/TextLink";
import { SAFETY_PRIVACY_PATH } from "@/features/public-site/policy-links";
import { setAnalyticsChoice } from "./analytics-client";
import { analyticsRouteTemplate } from "./analytics-events";

/**
 * The one-time analytics question (issue #413), shown only where analytics
 * could run and the visitor has not chosen. Until they press Accept nothing is
 * stored or sent. It stays out of the Play screen, whose footer navigation it
 * would cover; Safety & Privacy always offers the same choice.
 */
export function AnalyticsConsentPrompt() {
  const category = analyticsRouteTemplate(usePathname())?.category;
  if (category === undefined || category === "play") return null;

  return (
    <section
      aria-labelledby="analytics-consent-title"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-navigation)] px-4 py-4 shadow-[var(--rs-shadow-panel)]"
      data-testid="analytics-consent-prompt"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-3xl text-sm leading-6 text-[color:var(--rs-text-secondary)]">
          <h2
            className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]"
            id="analytics-consent-title"
          >
            Help us understand how RuneSpace is found and played?
          </h2>
          <p>
            With your OK, RuneSpace uses PostHog analytics to count visits, where they come from,
            and how far people get through account setup and early play. It stores a random ID in
            this browser and never records chat, what you type, or your email. Until you choose,
            nothing is stored or sent.{" "}
            <TextLink href={SAFETY_PRIVACY_PATH}>What this covers</TextLink>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <ActionButton onClick={() => setAnalyticsChoice("on")} type="button">
            Accept
          </ActionButton>
          <ActionButton intent="secondary" onClick={() => setAnalyticsChoice("off")} type="button">
            Decline
          </ActionButton>
        </div>
      </div>
    </section>
  );
}
