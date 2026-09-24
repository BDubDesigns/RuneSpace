"use client";

import { useEffect, useState } from "react";
import { presentSoftAlphaLaunch } from "@/game/domain/soft-alpha-launch";

/**
 * The one shared Soft Alpha countdown / LAUNCH IMMINENT! surface (issue #223),
 * used by the public landing, the waiting Characters experience, and the
 * Operator Console so they can never disagree.
 *
 * It is presentation only. The server renders it from the persisted target and
 * public-gameplay switch at a server reference time (`serverNow`); after
 * hydration the browser keeps ticking on a clock anchored to that server time,
 * not to its own wall clock. Reaching zero never writes, refreshes, or grants
 * anything: it simply reads LAUNCH IMMINENT! until an operator opens public
 * gameplay. Once public gameplay is open it renders nothing.
 */
export function SoftAlphaCountdown({
  launchTargetAt,
  publicGameplayOpen,
  serverNow,
  compact = false,
  className = "",
}: {
  /** ISO instant of the persisted launch target. */
  launchTargetAt: string;
  publicGameplayOpen: boolean;
  /** ISO server reference time the page was rendered at. */
  serverNow: string;
  /** One-line form for a secondary surface (the Early Access callout). */
  compact?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date(serverNow));

  useEffect(() => {
    const serverOffset = Date.parse(serverNow) - Date.now();
    const tick = () => setNow(new Date(Date.now() + serverOffset));
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [serverNow]);

  const presentation = presentSoftAlphaLaunch({
    publicGameplayOpen,
    launchTargetAt: new Date(launchTargetAt),
    now,
  });
  if (presentation.kind === "open") return null;

  if (compact) {
    return (
      <p
        className={`flex flex-wrap items-baseline gap-x-2 ${className}`}
        data-testid="soft-alpha-countdown"
      >
        {presentation.kind === "countdown" ? (
          <>
            <span className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
              {presentation.label}
            </span>
            <span
              className="whitespace-nowrap font-display text-sm font-bold tabular-nums text-[color:var(--rs-text-primary)]"
              role="timer"
            >
              {presentation.text}
            </span>
          </>
        ) : (
          <span
            className="font-display text-sm font-bold uppercase tracking-wide text-[color:var(--rs-accent-mining)]"
            role="status"
          >
            {presentation.label}
          </span>
        )}
      </p>
    );
  }

  return (
    <div className={className} data-testid="soft-alpha-countdown">
      {presentation.kind === "countdown" ? (
        <>
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
            {presentation.label}
          </p>
          <p
            className="mt-1 whitespace-nowrap font-display text-xl font-bold tabular-nums tracking-wide text-[color:var(--rs-text-primary)] sm:text-2xl"
            role="timer"
            aria-label={`${presentation.label} ${presentation.parts.days} days ${presentation.parts.hours} hours ${presentation.parts.minutes} minutes`}
          >
            {presentation.text}
          </p>
        </>
      ) : (
        <p
          className="font-display text-xl font-bold uppercase tracking-wide text-[color:var(--rs-accent-mining)] sm:text-2xl"
          role="status"
        >
          {presentation.label}
        </p>
      )}
    </div>
  );
}
