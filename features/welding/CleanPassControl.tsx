"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { usePlay } from "@/features/play/PlayContext";
import { claimCleanPassAction } from "@/server/actions";
import type { CleanPassProjection } from "@/server/play";

/** How long the success flash stays up. Brief and non-blocking, on purpose. */
const SUCCESS_FLASH_MS = 2_400;

/**
 * The Clean Pass control, for every kind of Welding (#190).
 *
 * One component serves Practice and both authored repairs, because Clean Pass
 * is one mechanic: the projection says where this work unit's opportunities
 * fall and how far the work has got, and `sectionsCompleted + 1` is the section
 * being welded right now — the same positional truth the server validates a
 * claim against. The live countdown reuses the ordinary attempt window every
 * Welding surface already renders, so there is no second timing channel.
 *
 * It appears beside the normal controls and never replaces or hides them:
 * missing a Clean Pass costs nothing, so it must never be in the way of the
 * work itself.
 */
export function CleanPassControl({ cleanPass }: { cleanPass?: CleanPassProjection }) {
  const { acceptState, enqueueForeground, foregroundBusy, releaseCommand, state } = usePlay();
  const [now, setNow] = useState(Date.now());
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<string>();
  const [flash, setFlash] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [, startTransition] = useTransition();
  const announcedSection = useRef<number | undefined>(undefined);

  const action = state.activeAction;
  const openSection = cleanPass?.opportunities.find(
    (opportunity) =>
      opportunity.outcome === null && opportunity.section === cleanPass.sectionsCompleted + 1,
  );

  useEffect(() => {
    if (!openSection) return;
    const clock = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(clock);
  }, [openSection?.section]);

  useEffect(() => {
    if (!openSection) {
      announcedSection.current = undefined;
      return;
    }
    if (announcedSection.current === openSection.section) return;
    announcedSection.current = openSection.section;
    setAnnouncement("Clean Pass available now.");
  }, [openSection?.section]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(false), SUCCESS_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  if (!cleanPass || !action) return null;

  function claim() {
    if (!openSection || claiming) return;
    enqueueForeground(() => {
      setClaiming(true);
      startTransition(async () => {
        try {
          const result = await claimCleanPassAction({ characterId: state.characterId });
          if ("error" in result) {
            setMessage(result.error);
            return;
          }
          acceptState(result.state);
          if (result.cleanPass.status === "claimed") {
            setMessage(undefined);
            setFlash(true);
            setAnnouncement(`Clean Pass. ${result.cleanPass.awardedXp} Welding XP.`);
          } else {
            setMessage(result.cleanPass.message);
          }
        } catch (error) {
          reportClientDiagnostic("mining-command", error);
          setMessage("Comms interruption. The Clean Pass could not be confirmed.");
        } finally {
          setClaiming(false);
          releaseCommand();
        }
      });
    });
  }

  const sectionEndsAt = new Date(action.nextAttemptAt).getTime();
  const sectionStartedAt = new Date(action.progressStartedAt).getTime();
  const sectionMs = Math.max(1, sectionEndsAt - sectionStartedAt);
  const remaining = Math.max(0, sectionEndsAt - now);

  return (
    <section
      aria-label="Clean Pass opportunity"
      className="mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-clean-pass
      data-clean-pass-state={openSection ? "open" : flash ? "claimed" : "waiting"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]">
            Optional
          </p>
          <p className="mt-1 font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
            {flash ? "STACKIN' DIMES!" : openSection ? "Lay it in clean" : "Watch the bead"}
          </p>
        </div>
        <ActionButton
          data-clean-pass-claim
          disabled={!openSection || claiming || (foregroundBusy && !claiming)}
          intent="mission"
          loading={claiming}
          onClick={claim}
        >
          Clean Pass
        </ActionButton>
      </div>

      {openSection ? (
        <div className="mt-3" data-clean-pass-countdown>
          <StatusMeter
            detail={`${(remaining / 1_000).toFixed(1)}s`}
            label="Clean Pass window"
            value={Math.min(100, Math.max(0, (remaining / sectionMs) * 100))}
          />
        </div>
      ) : null}

      {message ? (
        <div className="mt-3">
          <Feedback tone="muted">{message}</Feedback>
        </div>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </section>
  );
}
