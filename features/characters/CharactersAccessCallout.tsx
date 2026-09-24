import { Panel } from "@/components/ui/Panel";
import { SoftAlphaCountdown } from "@/features/launch/SoftAlphaCountdown";

/**
 * The Characters experience's pre-launch treatment (issue #223).
 *
 * `access` is derived server-side from the authoritative gameplay-access
 * decision; this component only renders it and never decides access:
 * - `waiting` — verified account, public gameplay closed, no Early Access:
 *   the reservation waiting state (`Claim your crew` / `Your crew is reserved`);
 * - `early_access` — the account may play before public Soft Alpha;
 * - `open` — public gameplay is open: the normal playable experience, no
 *   reservation treatment or countdown.
 */
export type CharactersAccess = "waiting" | "early_access" | "open";

export function CharactersAccessCallout({
  access,
  hasCharacters,
  launchTargetAt,
  serverNow,
}: {
  access: CharactersAccess;
  hasCharacters: boolean;
  /** ISO instant of the persisted launch target, or null if unavailable. */
  launchTargetAt: string | null;
  serverNow: string;
}) {
  if (access === "open") return null;
  const countdown = launchTargetAt ? (
    <SoftAlphaCountdown
      className="mt-4"
      launchTargetAt={launchTargetAt}
      publicGameplayOpen={false}
      serverNow={serverNow}
    />
  ) : null;

  if (access === "early_access") {
    // A compact callout: the account plays normally, so Characters keeps its
    // ordinary mobile fit and the countdown is a single line.
    return (
      <Panel
        as="section"
        className="mt-4 !p-4"
        tone="raised"
        aria-labelledby="early-access-heading"
      >
        <h2
          className="font-display text-sm font-bold uppercase tracking-[0.12em] text-[color:var(--rs-accent-success)]"
          id="early-access-heading"
        >
          EARLY ACCESS ENABLED
        </h2>
        <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
          You can play now. Public Soft Alpha opens October 27.
        </p>
        {launchTargetAt ? (
          <SoftAlphaCountdown
            className="mt-2"
            compact
            launchTargetAt={launchTargetAt}
            publicGameplayOpen={false}
            serverNow={serverNow}
          />
        ) : null}
      </Panel>
    );
  }

  return (
    <Panel as="section" className="mt-6" tone="raised" aria-labelledby="soft-alpha-heading">
      <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
        SOFT ALPHA · OCTOBER 27
      </p>
      <h2
        className="mt-2 font-display text-2xl font-bold tracking-tight text-[color:var(--rs-text-primary)]"
        id="soft-alpha-heading"
      >
        {hasCharacters ? "Your crew is reserved" : "Claim your crew"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[color:var(--rs-text-secondary)]">
        {hasCharacters
          ? "Your character names and portraits are saved to your RuneSpace account. Soft Alpha opens October 27."
          : "Reserve your first character name before RuneSpace Soft Alpha opens October 27."}
      </p>
      {countdown}
    </Panel>
  );
}

/** A clear, non-interactive status on a reserved character card while waiting. */
export function ReadyForAlphaStatus() {
  return (
    <span className="inline-flex border border-[color:var(--rs-accent-success)] bg-[color:var(--rs-accent-success-subtle)] px-2 py-1 font-display text-xs font-bold uppercase tracking-[0.12em] text-[color:var(--rs-accent-success)]">
      READY FOR ALPHA
    </span>
  );
}
