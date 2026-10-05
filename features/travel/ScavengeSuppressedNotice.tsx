"use client";

import { Feedback } from "@/components/ui/Feedback";
import { usePlay } from "@/features/play/PlayContext";

/**
 * Explains why a walk will not offer Scavenge after the player turned back (#312).
 *
 * It renders from the authoritative `scavengeSuppressed` flag rather than from
 * the click that caused it, so it is still here after a reload, a reconnect, or
 * logging out and in — there is no client-side latch to lose. Mid-Journey the
 * Journey panel says the same thing about that walk, so this stays out of the way
 * while in transit.
 */
export function ScavengeSuppressedNotice() {
  const { state } = usePlay();
  if (!state.scavengeSuppressed || state.travelState) return null;
  return (
    <div data-scavenge-suppressed-notice>
      <Feedback>
        You turned back, so Scavenge is unavailable until you complete a walk. Riding does not
        count.
      </Feedback>
    </div>
  );
}
