"use client";

import { LOCAL_PLACE_IDS, LOCATION_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { resolveActiveLocalPlace } from "@/game/domain/local-places";
import { CargoHoldPanel } from "@/features/cargo/CargoHoldPanel";
import { CrewStopPanel } from "@/features/local-places/CrewStopPanel";
import { MiningActivity } from "@/features/mining/MiningActivity";
import { PowerAnnexClaimPanel } from "@/features/power-annex/PowerAnnexClaimPanel";
import { WorkbenchPanel } from "@/features/practice/WorkbenchPanel";
import { RefiningConsole } from "@/features/refining/RefiningConsole";
import { RepairWorkPanel } from "@/features/welding/RepairWorkPanel";
import { usePlay } from "@/features/play/PlayContext";

/**
 * The primary activity at wherever the player is standing (#193).
 *
 * This is the same narrow mapping the location panel used to hold inline — one
 * authored place to the one component that owns its gameplay — lifted out so
 * the activity can be a sibling of the place rather than nested inside it.
 * Every activity now renders at the same level, in the same frame, in the same
 * position on the screen.
 *
 * Deliberately still a switch. A registry, a plugin table or a content-declared
 * activity ID would be a framework built for six hand-authored cases, which
 * #193 rules out: the cost of a seventh location is one line here.
 *
 * A place with no activity renders nothing at all — not an empty frame and not
 * a "nothing to do here" placeholder. The Long Scramble, Holo Hollow's town
 * surface and the shops are identity and people, and that is the whole surface.
 *
 * Each activity decides for itself whether it has anything to show yet: the
 * Workbench is scenery until Wade puts the player on the bench, and the Crew
 * Stop repair does not exist until the Mission that starts it is accepted.
 */
export function LocationActivity({
  characterName,
  localPlaceId,
}: {
  characterName: string;
  /**
   * The Local Place the route currently has open. Presentation state only —
   * the character's authoritative position is still the parent World Location,
   * and every command this surface reaches revalidates its own location
   * server-side.
   */
  localPlaceId?: string;
}) {
  const { state } = usePlay();
  if (state.travelState) return null;

  const locationId = state.location.currentLocationId;
  // Navigation state, validated exactly as the place surface validates it: a
  // hand-edited URL naming an unknown, wrong-parent or locked place falls back
  // to the World Location, so it can never reveal an interior's activity.
  const activePlace = resolveActiveLocalPlace({
    locationId,
    requestedLocalPlaceId: localPlaceId,
    completedMissionIds: deriveCompletedMissionIds(state.missions),
  });

  if (activePlace) {
    return activePlace.id === LOCAL_PLACE_IDS.holoHollowCrewStop ? <CrewStopPanel /> : null;
  }

  switch (locationId) {
    case LOCATION_IDS.theJag:
      return <MiningActivity characterName={characterName} />;
    case LOCATION_IDS.deepJag:
      // One place, two jobs, and the repair's own completion decides which
      // (#209). There is no Deep-Jag-specific repair surface and no second
      // unlock flag: while the brace is unfinished this is a Welding job, and
      // the moment the fifteenth section lands the same location is a mine.
      return state.repairs[REPAIR_TARGET_IDS.deepJagCaveIn]?.complete ? (
        <MiningActivity characterName={characterName} />
      ) : (
        <RepairWorkPanel
          eyebrow="Collapsed Passage"
          materialsPrompt="Tansy's brace and jack are already down here. What the support needs is the stock to build it out of; hand over what you are carrying and bring the rest when you come back."
          targetId={REPAIR_TARGET_IDS.deepJagCaveIn}
          title="Bracing"
          weldingPrompt="Everything is set. What is left is welding the support together so it will take the roof's weight."
        />
      );
    case LOCATION_IDS.abandonedProcessingYard:
      return <RefiningConsole />;
    case LOCATION_IDS.crashSite:
      return <CargoHoldPanel />;
    case LOCATION_IDS.emergencyPowerAnnex:
      return <PowerAnnexClaimPanel />;
    case LOCATION_IDS.ruskRecovery:
      // One bench, one component: which controls it shows follows the
      // authoritative Workbench occupancy rather than each surface deciding
      // independently whether to appear (#207).
      return <WorkbenchPanel />;
    default:
      return null;
  }
}
