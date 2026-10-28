"use client";

import { usePathname } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { TextLink } from "@/components/ui/TextLink";
import { SAFETY_PRIVACY_PATH } from "@/features/public-site/policy-links";
import { setAnalyticsChoice } from "./analytics-client";
import { analyticsRouteTemplate } from "./analytics-events";
import { VISIT_COUNT_SETTINGS_ID } from "./referral-counts";

/**
 * The one-time PostHog question (issues #413, #425), shown only where
 * analytics could run and the visitor has not chosen. Until they press the
 * first button nothing goes to PostHog. The anonymous daily visit totals are
 * separate and are disclosed here too, with a link to their own objection
 * control. The two buttons are deliberately identical in weight and effort.
 * It stays out of the Play screen, whose footer navigation it would cover;
 * Safety & Privacy always offers the same choice.
 */
export function AnalyticsConsentPrompt() {
  const category = analyticsRouteTemplate(usePathname())?.category;
  if (category === undefined || category === "play") return null;

  return (
    <section
      aria-labelledby="analytics-consent-title"
      className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto border-t border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-navigation)] px-4 py-4 shadow-[var(--rs-shadow-panel)]"
      data-testid="analytics-consent-prompt"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-3xl space-y-2 text-sm leading-6 text-[color:var(--rs-text-secondary)]">
          <h2
            className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]"
            id="analytics-consent-title"
          >
            Help a solo dev make RuneSpace better?
          </h2>
          <p>
            Hey! I&apos;m building RuneSpace while working a full-time job. My dream is to make this
            my full-time work someday, so I can ship updates faster and spend more time at home with
            my partner and daughter.{" "}
            <span aria-label="heart" role="img">
              ❤️
            </span>
          </p>
          <p>
            RuneSpace counts basic page visits and where they came from in daily totals, without
            following individual visitors. If you&apos;re comfortable, letting me use optional
            PostHog analytics helps me see what players explore and where new people get stuck, so I
            can make the most of the time I have. It&apos;s completely your choice, saying no is
            fine, and you can change it anytime. Until you choose, nothing goes to PostHog.{" "}
            <TextLink href={`${SAFETY_PRIVACY_PATH}#${VISIT_COUNT_SETTINGS_ID}`}>
              Privacy &amp; visit-count settings
            </TextLink>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ActionButton onClick={() => setAnalyticsChoice("on")} type="button">
            Help me improve RuneSpace
          </ActionButton>
          <ActionButton onClick={() => setAnalyticsChoice("off")} type="button">
            No thanks
          </ActionButton>
        </div>
      </div>
    </section>
  );
}
