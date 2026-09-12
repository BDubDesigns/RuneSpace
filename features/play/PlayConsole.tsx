"use client";

import { useEffect, useTransition } from "react";
import { CargoReadout } from "@/features/shared/CargoReadout";
import { SkillProgressCard } from "@/features/shared/run-presentation";
import { RefiningRunPanel } from "@/features/refining/RefiningRunPanel";
import { MiningRunPanel } from "@/features/mining/MiningRunPanel";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { LOCATION_IDS } from "@/game/config/foundations";
import { LocationSurface } from "@/features/location-scene/LocationSurface";
import { InventoryEquipmentPanel } from "@/features/inventory/InventoryEquipmentPanel";
import { MissionLogPanel } from "@/features/missions/MissionLogPanel";
import { MissionGuidanceStrips } from "@/features/missions/MissionGuidanceStrips";
import { NpcInteractionPanel } from "@/features/npc/NpcInteractionPanel";
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
  const balance = getEffectiveGameBalance();
  const inTransit = Boolean(state.travelState);
  const currentLocationId = state.location.currentLocationId;
  const stationaryPrimary = surface === "primary" && !inTransit;
  const showMiningActivity = stationaryPrimary && currentLocationId === LOCATION_IDS.theJag;
  const showRefiningActivity =
    stationaryPrimary && currentLocationId === LOCATION_IDS.abandonedProcessingYard;
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
    <div className="space-y-4">
      {/* Mission guidance leads every Play surface, directly under the header. */}
      <MissionGuidanceStrips state={state} />
      {surface === "map" ? (
        <LocalMapPanel onBack={onMapExit} onTravelStarted={onMapExit} />
      ) : inTransit ? (
        <JourneyPanel />
      ) : (
        <LocationSurface characterName={characterName} localPlaceId={localPlaceId} />
      )}

      {surface === "primary" ? (
        <>
          {!inTransit ? (
            // Keyed by the requested place so a contact's opened Trade surface
            // never survives leaving the place and reappears on return.
            <NpcInteractionPanel key={localPlaceId ?? ""} localPlaceId={localPlaceId} />
          ) : null}
          {showMiningActivity || showRefiningActivity ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {showMiningActivity ? (
                  <SkillProgressCard
                    level={state.mining.level}
                    title="Mining progression"
                    tone="mining"
                    totalXp={state.mining.totalXp}
                    xpIntoLevel={state.mining.xpIntoLevel}
                    xpToNextLevel={state.mining.xpToNextLevel}
                  />
                ) : (
                  <SkillProgressCard
                    level={state.refining.level}
                    title="Refining progression"
                    tone="refining"
                    totalXp={state.refining.totalXp}
                    xpIntoLevel={state.refining.xpIntoLevel}
                    xpToNextLevel={state.refining.xpToNextLevel}
                  />
                )}
                {showMiningActivity ? (
                  <CargoReadout
                    state={state}
                    items={[{ label: "Ferrite Shale", quantity: state.ferriteShaleQuantity }]}
                  />
                ) : (
                  <CargoReadout
                    state={state}
                    items={[
                      { label: "Refined Ferrite", quantity: state.refinedFerriteQuantity },
                      { label: "Slag", quantity: state.slagQuantity },
                    ]}
                  />
                )}
              </div>
              {showMiningActivity ? (
                <MiningRunPanel run={state.run} balance={balance} />
              ) : (
                <RefiningRunPanel
                  ferriteQuantity={state.refinedFerriteQuantity}
                  run={state.refiningRun}
                  slagQuantity={state.slagQuantity}
                />
              )}
            </>
          ) : null}
        </>
      ) : null}

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
