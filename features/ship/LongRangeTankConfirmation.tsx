"use client";

import { useEffect, useState } from "react";
import { usePlay } from "@/features/play/PlayContext";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { getMission } from "@/game/content/missions";
import { getRepairTarget } from "@/game/content/repair-targets";

/**
 * The final-weld beat of Tanks for the Ride (#501): a Mission Complete
 * confirmation plus the capacity change, shown once in the session where the
 * thirty-second section lands.
 *
 * It reads only authoritative facts: it opens on the repair's own completion
 * transition (`justCompleted`, derived by the Ship system shell from the repair
 * projection) and states the capacity from the ship projection, so there is no
 * UI-only upgrade flag. Reusing the existing success treatment keeps it to the
 * established motion, which reduced-motion settings already calm. A reload or a
 * later visit shows the finished system's ordinary status line instead.
 */
export function LongRangeTankConfirmation({
  targetId,
  justCompleted,
}: {
  /** The long-range tank repair target; its authorizing Mission supplies the title. */
  targetId: string;
  justCompleted: boolean;
}) {
  const { state } = usePlay();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (justCompleted) setShown(true);
  }, [justCompleted]);

  if (!shown) return null;
  const authorization = getRepairTarget(targetId)?.authorization;
  const title =
    (authorization?.kind === "mission" ? getMission(authorization.missionId)?.title : undefined) ??
    "Mission";
  const before = getEffectiveGameBalance().ship.tankCapacityFuelUnits;
  return (
    <section
      className="rs-result-feedback-success border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-4"
      data-ship-tank-upgrade="complete"
      role="status"
    >
      <p className="font-display text-lg font-bold uppercase tracking-wide">
        {title} — Mission Complete
      </p>
      <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
        Long-range tanks installed. Rivet fuel capacity: {before} →{" "}
        {state.ship.tankCapacityFuelUnits} FU. Current fuel unchanged.
      </p>
    </section>
  );
}
