/**
 * The shared Soft Alpha launch presentation (issue #223).
 *
 * One pure derivation from the persisted launch target, the persisted public
 * gameplay switch, and a reference "now" (server time on the server; a
 * server-anchored clock in the browser). The public landing, the waiting
 * Characters experience, and the Operator Console all render through it, so
 * they cannot disagree.
 *
 * This is presentation only: it never grants access and never writes anything.
 * At or after the target while public gameplay is still closed it reads
 * **LAUNCH IMMINENT!** and stays that way until an operator explicitly opens
 * public gameplay; it never shows a zero or negative countdown.
 */

export const SOFT_ALPHA_COUNTDOWN_LABEL = "SOFT ALPHA OPENS IN";
export const SOFT_ALPHA_LAUNCH_IMMINENT = "LAUNCH IMMINENT!";

export type SoftAlphaCountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export type SoftAlphaLaunchPresentation =
  | { kind: "open" }
  | {
      kind: "countdown";
      label: typeof SOFT_ALPHA_COUNTDOWN_LABEL;
      parts: SoftAlphaCountdownParts;
      /** e.g. `34D · 07H · 12M · 09S`. */
      text: string;
    }
  | { kind: "imminent"; label: typeof SOFT_ALPHA_LAUNCH_IMMINENT };

const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

export function formatSoftAlphaCountdown(parts: SoftAlphaCountdownParts): string {
  return `${parts.days}D · ${pad2(parts.hours)}H · ${pad2(parts.minutes)}M · ${pad2(parts.seconds)}S`;
}

export function presentSoftAlphaLaunch(input: {
  publicGameplayOpen: boolean;
  launchTargetAt: Date;
  now: Date;
}): SoftAlphaLaunchPresentation {
  if (input.publicGameplayOpen) return { kind: "open" };
  // Whole seconds remaining, rounded UP: the countdown stays positive through
  // the final fractional second (target − 1 ms reads "0D · 00H · 00M · 01S").
  // Only the exact target instant and every instant after it read LAUNCH
  // IMMINENT! — never "0D · 00H · 00M · 00S" and never a negative countdown.
  const remainingSeconds = Math.ceil(
    (input.launchTargetAt.getTime() - input.now.getTime()) / SECOND_MS,
  );
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
    return { kind: "imminent", label: SOFT_ALPHA_LAUNCH_IMMINENT };
  }
  const parts: SoftAlphaCountdownParts = {
    days: Math.floor(remainingSeconds / DAY_S),
    hours: Math.floor((remainingSeconds % DAY_S) / HOUR_S),
    minutes: Math.floor((remainingSeconds % HOUR_S) / MINUTE_S),
    seconds: remainingSeconds % MINUTE_S,
  };
  return {
    kind: "countdown",
    label: SOFT_ALPHA_COUNTDOWN_LABEL,
    parts,
    text: formatSoftAlphaCountdown(parts),
  };
}

/**
 * The launch target as the Operator Console states it, e.g.
 * `October 27, 2026 · 9:00 AM Pacific`, always in America/Los_Angeles
 * regardless of the server or browser time zone.
 */
export function formatLaunchTargetPacific(launchTargetAt: Date): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(launchTargetAt);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(launchTargetAt)
    // Modern ICU separates "AM" with a narrow no-break space; the locked copy
    // uses an ordinary space.
    .replace(/ /g, " ");
  return `${date} · ${time} Pacific`;
}
