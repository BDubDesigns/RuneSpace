"use client";

import { LOCAL_PLACE_IDS, LOCATION_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { resolveActiveLocalPlace } from "@/game/domain/local-places";
import { CargoHoldPanel } from "@/features/cargo/CargoHoldPanel";
import { CrewStopPanel } from "@/features/local-places/CrewStopPanel";
import { MiningActivity } from "@/features/mining/MiningActivity";
import { PowerAnnexClaimPanel } from "@/features/power-annex/PowerAnnexClaimPanel";
import { RuskRecoveryWorkAreas } from "@/features/location-scene/RuskRecoveryWorkAreas";
import { RefiningConsole } from "@/features/refining/RefiningConsole";
import { SiteStashPanel } from "@/features/site-stash/SiteStashPanel";
import { RepairWorkPanel } from "@/features/welding/RepairWorkPanel";
import { usePlay } from "@/features/play/PlayContext";
import type { RepairProjection } from "@/server/play";

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
    switch (activePlace.id) {
      case LOCAL_PLACE_IDS.holoHollowCrewStop:
        return <CrewStopPanel />;
      case LOCAL_PLACE_IDS.hhBnb:
        return (
          <CurlyStashMountActivity repair={state.repairs[REPAIR_TARGET_IDS.curlyStashMount]} />
        );
      default:
        return null;
    }
  }

  return (
    <>
      {primaryActivity(locationId, characterName, state)}
      {/* A site stash (#284) is a sibling of the site's own activity, never a
          replacement for it. It renders nothing until the server projects one,
          which it does only for a character who has earned the site's mount. */}
      <SiteStashPanel />
    </>
  );
}

function primaryActivity(
  locationId: string,
  characterName: string,
  state: ReturnType<typeof usePlay>["state"],
) {
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
      // Wade's Welding Workshop — one bench, one component, following the
      // authoritative Workbench occupancy (#207) — and, once Tansy opens it,
      // the Fabrication Station beside it (#232).
      return <RuskRecoveryWorkAreas />;
    default:
      return null;
  }
}

/**
 * Curly's commission at HH B&B (#292): building the mount for the container he
 * already owns.
 *
 * It exists only while the work is genuinely open — the repair is authorized
 * by Curly Must-Stash's acceptance and not yet finished. Before that there is
 * nothing to build, and the moment the last section lands the job is done and
 * the activity goes: the mount is Curly's, in Curly's room, so there is no
 * finished-state panel and no storage to open. Mission guidance then points the
 * player back to Curly for the rest of their payment.
 */
function CurlyStashMountActivity({ repair }: { repair: RepairProjection | undefined }) {
  if (!repair?.repairAvailable || repair.complete) return null;
  return (
    <RepairWorkPanel
      eyebrow="Curly's room"
      materialsPrompt="Curly's container is ready to go up. The mount needs its frame stock before there is anything to weld; hand over what you are carrying and bring the rest when you come back."
      targetId={REPAIR_TARGET_IDS.curlyStashMount}
      title="Build Stash Mount"
      weldingPrompt="The frame stock is all here. What is left is welding the mount to the wall."
    />
  );
}
