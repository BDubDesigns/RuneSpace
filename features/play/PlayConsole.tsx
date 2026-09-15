"use client";

import { useEffect, useTransition } from "react";
import { LocationActivity } from "@/features/location-scene/LocationActivity";
import { LocationSurface } from "@/features/location-scene/LocationSurface";
import { InventoryEquipmentPanel } from "@/features/inventory/InventoryEquipmentPanel";
import { MissionLogPanel } from "@/features/missions/MissionLogPanel";
import { MissionGuidanceStrips } from "@/features/missions/MissionGuidanceStrips";
import { WorkOrdersTerminal } from "@/features/practice/WorkOrdersTerminal";
import { JourneyPanel } from "@/features/travel/JourneyPanel";
import { LocalMapPanel } from "@/features/travel/LocalMapPanel";
import { ScavengeRevealOverlay } from "@/features/travel/ScavengeRevealOverlay";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { refreshPlayAction } from "@/server/actions";
import { usePlay } from "./PlayContext";

export type PlaySurface = "primary" | "map";

/**
 * Generic player-facing composition. The primary surface is derived from the
 * authoritative Travel state; Map is the only explicitly routed surface.
 * Activities and overlays remain feature-owned and server-authoritative.
 *
 * Since #193 this shell composes whole surfaces and nothing smaller. It used to
 * assemble Mining's, Refining's and Practice's skill cards, cargo readouts and
 * run panels itself, from `currentLocationId` branches — which meant the parts
 * of one activity were owned by three different files and a seventh activity
 * would have meant another branch here. Each activity now renders its own
 * context and run summary inside its own frame, and the shell decides only the
 * order they appear in.
 */
export function PlayConsole({
  characterName,
  localPlaceId,
  surface = "primary",
  onMapExit,
}: {
  characterName: string;
  /**
   * The Local Place the route currently has open. Presentation state only: it
   * decides which resident and place surface are shown, never what a server
   * command is allowed to do.
   */
  localPlaceId?: string;
  surface?: PlaySurface;
  onMapExit: () => void;
}) {
  const {
    acquireCommand,
    acceptState,
    inventoryOpen,
    inventoryTrigger,
    missionsOpen,
    missionsFocus,
    missionsTrigger,
    releaseCommand,
    setInventoryOpen,
    setMissionsOpen,
    setRefreshCallback,
    state,
  } = usePlay();
  const inTransit = Boolean(state.travelState);
  const [, startTransition] = useTransition();

  function applyReconciliation(result: Awaited<ReturnType<typeof refreshPlayAction>>) {
    if (result.error) {
      reportClientDiagnostic("play-boundary", new Error(result.error), {
        miningActive: false,
      });
      return;
    }
    if (result.state) acceptState(result.state);
  }

  function reconcile(opts?: { background?: boolean }) {
    if (!acquireCommand(opts)) return;
    startTransition(async () => {
      try {
        applyReconciliation(await refreshPlayAction(state.characterId));
      } catch (error) {
        reportClientDiagnostic("play-boundary", error, {
          miningActive: Boolean(state.activeAction),
        });
      } finally {
        releaseCommand();
      }
    });
  }

  useEffect(() => {
    setRefreshCallback((opts?: { background?: boolean }) => reconcile(opts));
  });

  return (
    // 12px between surfaces, matching the rhythm inside an activity panel
    // (#193). The stack used to be 16px, which read as a page of separate
    // documents rather than one screen — and at Rusk Recovery, where two
    // Mission strips push everything down, those pixels are clearance under
    // the Workbench's Start control.
    <div className="space-y-3">
      {/* Mission guidance leads every Play surface, directly under the header. */}
      <MissionGuidanceStrips state={state} />
      {surface === "map" ? (
        <LocalMapPanel onBack={onMapExit} onTravelStarted={onMapExit} />
      ) : inTransit ? (
        <JourneyPanel />
      ) : (
        <>
          {/* The grammar, in order (#193): the place, then the one thing you
              came here to do, then the systems that are their own thing.
              Each activity owns its own controls, context and run summary, so
              this shell composes surfaces rather than assembling any one
              activity's parts from a location branch. */}
          <LocationSurface characterName={characterName} localPlaceId={localPlaceId} />
          <LocationActivity characterName={characterName} localPlaceId={localPlaceId} />
          <WorkOrdersTerminal />
        </>
      )}

      <ScavengeRevealOverlay />

      {inventoryOpen ? (
        <InventoryEquipmentPanel
          state={state}
          onClose={() => setInventoryOpen(false)}
          triggerRef={inventoryTrigger}
        />
      ) : missionsOpen ? (
        <MissionLogPanel
          focusedMissionId={missionsFocus}
          onClose={() => setMissionsOpen(false)}
          state={state}
          triggerRef={missionsTrigger}
        />
      ) : null}
    </div>
  );
}
