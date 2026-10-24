"use client";

import { useEffect, useState } from "react";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { derivePinnedGuidanceTargets } from "@/features/missions/mission-pins";
import { usePlay } from "@/features/play/PlayContext";
import { seconds } from "@/features/shared/duration-copy";
import { useStationCommand } from "@/features/shared/use-station-command";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { startEchoReadingAction } from "@/server/actions";
import type { PlayGameplayState } from "@/server/play";
import {
  ECHO_CAPACITY_ADVISORY,
  echoClueVerdict,
  echoDirectionsCopy,
  echoReadingErrorMessage,
  echoReadingTime,
} from "./echo-copy";

function describe(state: PlayGameplayState): string | undefined {
  if (state.commandError === "another_action_active") {
    return "Another activity is active. Finish it before taking a reading.";
  }
  return state.echoReadingError ? echoReadingErrorMessage(state.echoReadingError) : undefined;
}

/**
 * The Beginner Echo Seeker's part of its ordinary Item Details (#393): which
 * planet a reading would search, that planet's last reading and whether the
 * hex the player stands on fits it, the capacity advisory, and Use.
 *
 * Opening this changes nothing: every fact here is the server's projection, and
 * the ruled-out line is derived from it. Use stays available on a ruled-out hex
 * — a player may always spend a Seeker on a fresh reading. While a reading runs,
 * its live timer replaces the control; what it found is the server's to say.
 */
export function EchoSeekerDetails() {
  const { foregroundBusy, state } = usePlay();
  const hunt = state.echoHunt;
  const command = useStationCommand(describe);
  const guidance = derivePinnedGuidanceTargets(state);
  const reading =
    state.activeAction?.actionId === hunt.readingActionId ? state.activeAction : undefined;
  const last = hunt.lastReading;

  return (
    <div
      className="mt-3 space-y-2 border-t border-[color:var(--rs-border-subtle)] pt-3 text-sm text-[color:var(--rs-text-secondary)]"
      data-echo-seeker-details
    >
      <p data-echo-searching>
        {hunt.searching ? (
          <>
            <span className="font-semibold text-[color:var(--rs-text-primary)]">Searching:</span>{" "}
            {hunt.searching.planetName}
          </>
        ) : (
          "There are no Resonance Echoes to listen for on this world."
        )}
      </p>
      {hunt.searching ? (
        last ? (
          <>
            <p data-echo-last-reading>
              <span className="font-semibold text-[color:var(--rs-text-primary)]">
                Last reading:
              </span>{" "}
              {last.locationName}, {echoDirectionsCopy(last.eastWest, last.northSouth)},{" "}
              {echoReadingTime(last.readAt)}
            </p>
            <p
              className={
                last.check.ruledOut
                  ? "text-[color:var(--rs-accent-danger)]"
                  : "text-[color:var(--rs-text-primary)]"
              }
              data-echo-ruled-out={String(last.check.ruledOut)}
            >
              {echoClueVerdict(last.check, last.eastWest, last.northSouth, last.locationName)}
            </p>
          </>
        ) : (
          <p data-echo-last-reading="none">No reading on this planet yet.</p>
        )
      ) : null}
      <p className="text-xs" data-echo-capacity-advisory>
        {ECHO_CAPACITY_ADVISORY}
      </p>
      {reading ? (
        <ReadingProgress
          endsAt={reading.nextAttemptAt}
          startsAt={reading.progressStartedAt}
          planetName={hunt.searching?.planetName}
        />
      ) : hunt.searching ? (
        <MissionActionButton
          data-echo-use
          disabled={foregroundBusy}
          guidance={guidance.actionIds.has(hunt.readingActionId) ? "active" : undefined}
          intent="arcane"
          loading={command.pending === "use"}
          onClick={() =>
            command.run("use", () => startEchoReadingAction({ characterId: state.characterId }))
          }
        >
          Use · {seconds(hunt.readingDurationTicks, GAME_TICK_MS)}
        </MissionActionButton>
      ) : null}
      {command.message ? <Feedback tone="danger">{command.message}</Feedback> : null}
    </div>
  );
}

function ReadingProgress({
  startsAt,
  endsAt,
  planetName,
}: {
  startsAt: string;
  endsAt: string;
  planetName?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, []);
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const remainingMs = Math.max(0, end - now);
  return (
    <div data-echo-reading>
      <StatusMeter
        accentColor="var(--rs-skill-runeworking)"
        detail={remainingMs === 0 ? "Resolving" : `${(remainingMs / 1000).toFixed(1)}s`}
        label={planetName ? `Listening on ${planetName}` : "Listening"}
        value={end === start ? 100 : Math.min(100, ((now - start) / (end - start)) * 100)}
      />
    </div>
  );
}
