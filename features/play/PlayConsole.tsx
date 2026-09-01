"use client";

import { useEffect, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkillProgressCard } from "@/features/shared/run-presentation";
import { CargoReadout } from "@/features/shared/CargoReadout";
import { RefiningRunPanel } from "@/features/refining/RefiningRunPanel";
import { MiningRunPanel } from "@/features/mining/MiningRunPanel";
import { MiningActivity } from "@/features/mining/MiningActivity";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { LOCATION_IDS } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { usePlay } from "./PlayContext";
import { LocalMapPanel } from "@/features/travel/LocalMapPanel";
import { ScavengeRevealOverlay } from "@/features/travel/ScavengeRevealOverlay";
import { RefiningConsole } from "@/features/refining/RefiningConsole";
import { PowerAnnexClaimPanel } from "@/features/power-annex/PowerAnnexClaimPanel";
import { LocationSceneHeader } from "@/features/location-scene/LocationSceneHeader";
import { CargoHoldPanel } from "@/features/cargo/CargoHoldPanel";
import { MissionObjectivePanel } from "@/features/missions/MissionObjectivePanel";
import { NpcInteractionPanel } from "@/features/npc/NpcInteractionPanel";
import { InventoryPanel } from "@/features/mining/InventoryPanel";
import { EquipmentPanel } from "@/features/mining/EquipmentPanel";
import { refreshPlayAction } from "@/server/actions";
import { reportClientDiagnostic } from "@/features/diagnostics/client";

/**
 * The generic player-facing play composition. It routes by the authoritative
 * location, composes every activity surface (Mining, Refining, Travel,
 * Scavenging, Cargo Hold, Power Annex, missions, NPC interactions, location
 * presentation), and hosts the shared Inventory/Equipment drawers. This is the
 * application play shell — it is not a Mining concern.
 */
export function PlayConsole({ characterName }: { characterName: string }) {
  const {
    acquireCommand,
    equipmentOpen,
    enqueueForeground,
    foregroundBusy,
    inventoryOpen,
    releaseCommand,
    setEquipmentOpen,
    setInventoryOpen,
    inventoryTrigger,
    equipmentTrigger,
    setRefreshCallback,
    acceptState,
    state,
  } = usePlay();
  const balance = getEffectiveGameBalance();
  const inTransit = Boolean(state.travelState);
  const currentLocationId = state.location.currentLocationId;
  const atProcessingYard = currentLocationId === LOCATION_IDS.abandonedProcessingYard;
  const atTheJag = currentLocationId === LOCATION_IDS.theJag;
  const atTheLongScramble = currentLocationId === LOCATION_IDS.theLongScramble;
  const showMiningActivity = atTheJag && !inTransit;
  const showRefiningActivity = atProcessingYard && !inTransit;

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
      <Panel tone="raised" className="overflow-hidden !p-0">
        {/* Responsive industrial scene header integrated into the top of the existing
            location/activity panel. Same asset on mobile + desktop; frame height
            is responsive (shallow cinematic strip on mobile, taller on desktop).
            Transit never shows the destination — location stays authoritative origin
            until arrival commits. */}
        {!inTransit
          ? (() => {
              const currentLocation = getLocation(currentLocationId);
              if (!currentLocation) return null;
              const atPowerAnnex = currentLocationId === LOCATION_IDS.emergencyPowerAnnex;
              return (
                <LocationSceneHeader
                  location={currentLocation}
                  characterName={characterName}
                  resourceLabels={
                    atTheJag
                      ? ["Ferrite Shale"]
                      : atProcessingYard
                        ? ["Refined Ferrite", "Slag"]
                        : atPowerAnnex
                          ? ["Power Cell"]
                          : undefined
                  }
                />
              );
            })()
          : null}
        <div className="p-5">
          {/* Eyebrow + resource plate now live inside the scene header; keep only
              a compact heading row here so the panel doesn't repeat the eyebrow.
              During transit the location truth is the walk description below. */}
          {!inTransit ? (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <SectionHeader eyebrow={getLocation(currentLocationId)?.displayName ?? "Location"}>
                Activity
              </SectionHeader>
            </div>
          ) : (
            <SectionHeader eyebrow="In transit">Journey</SectionHeader>
          )}

          {inTransit ? (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
              You are walking between locations. The active work stopped before departure, and no
              new activity can begin until you arrive. Use the world map below to follow your
              journey.
            </p>
          ) : atProcessingYard ? (
            <RefiningConsole />
          ) : atTheJag ? (
            <>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
                {getLocation(currentLocationId)?.description}
              </p>
              <MiningActivity characterName={characterName} />
            </>
          ) : currentLocationId === LOCATION_IDS.crashSite ? (
            <div className="mt-4">
              <CargoHoldPanel />
            </div>
          ) : atTheLongScramble ? (
            <div className="mt-4">
              <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
                {getLocation(currentLocationId)?.description}
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <p className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
                {getLocation(currentLocationId)?.description}
              </p>
              <div className="mt-4">
                <span className="text-sm text-[color:var(--rs-text-muted)]">
                  No production activity is available here.
                </span>
              </div>
            </div>
          )}
        </div>
      </Panel>
      <MissionObjectivePanel state={state} />
      {!inTransit ? <NpcInteractionPanel /> : null}
      <ScavengeRevealOverlay />
      <LocalMapPanel />
      <PowerAnnexClaimPanel />
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
      {inventoryOpen ? (
        <InventoryPanel
          state={state}
          onClose={() => setInventoryOpen(false)}
          triggerRef={inventoryTrigger}
        />
      ) : equipmentOpen ? (
        <EquipmentPanel
          onClose={() => setEquipmentOpen(false)}
          state={state}
          triggerRef={equipmentTrigger}
        />
      ) : null}
    </div>
  );
}
