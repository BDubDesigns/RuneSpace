"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { MissionGuidanceHalo, missionGuidanceClassName } from "@/components/ui/MissionGuidanceHalo";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { FabricateMode } from "@/features/fabrication/FabricateMode";
import { TinkerMode } from "@/features/fabrication/TinkerMode";
import { usePlay } from "@/features/play/PlayContext";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";

type StationMode = "fabricate" | "tinker";

/**
 * Rusk Recovery's Fabrication Station (#232): Fabricate, and — once Tansy's
 * Return the Favor demonstration has shown it — Tinker, as two modes of one
 * station. Manual Override is not a third mode; it lives inside Fabricate.
 *
 * Before Tansy puts the player on it, the station is scenery: nothing renders.
 */
export function FabricationStation() {
  const { state } = usePlay();
  const station = state.fabricationStation;
  const tinkering = state.tinkering;
  const tinkerBusy = tinkering.active || tinkering.cycle !== undefined;
  const [mode, setMode] = useState<StationMode>(tinkerBusy ? "tinker" : "fabricate");
  const guidance = deriveMissionGuidanceTargets(state.missions);
  const tinkerGuided = guidance.activities.has("tinkering");

  // Whatever is actually on the station is what the station shows.
  const onMachine = station.workpiece !== undefined;
  useEffect(() => {
    if (onMachine) setMode("fabricate");
  }, [onMachine]);
  useEffect(() => {
    if (tinkering.active) setMode("tinker");
  }, [tinkering.active]);

  if (!station.unlocked) return null;
  const shownMode: StationMode = tinkering.unlocked ? mode : "fabricate";

  return (
    <ActivityPanel
      eyebrow="Fabrication Station"
      title={shownMode === "tinker" ? "Tinker" : "Fabricate"}
      data-fabrication-station
      data-station-mode={shownMode}
    >
      {tinkering.unlocked ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Fabrication Station mode">
          <ActionButton
            aria-pressed={shownMode === "fabricate"}
            data-station-mode-select="fabricate"
            intent={shownMode === "fabricate" ? "primary" : "secondary"}
            onClick={() => setMode("fabricate")}
          >
            Fabricate
          </ActionButton>
          <MissionGuidanceHalo
            guidance={tinkerGuided && shownMode !== "tinker" ? "active" : undefined}
          >
            <ActionButton
              aria-pressed={shownMode === "tinker"}
              className={missionGuidanceClassName(
                tinkerGuided && shownMode !== "tinker" ? "active" : undefined,
              )}
              data-mission-guidance={tinkerGuided && shownMode !== "tinker" ? "active" : undefined}
              data-station-mode-select="tinker"
              intent={shownMode === "tinker" ? "primary" : "secondary"}
              onClick={() => setMode("tinker")}
            >
              Tinker
            </ActionButton>
          </MissionGuidanceHalo>
        </div>
      ) : null}

      {shownMode === "tinker" ? <TinkerMode /> : <FabricateMode />}

      <SkillProgressRow
        level={state.fabrication.level}
        skill="Fabrication"
        xpIntoLevel={state.fabrication.xpIntoLevel}
        {...(state.fabrication.xpToNextLevel === undefined
          ? {}
          : { xpToNextLevel: state.fabrication.xpToNextLevel })}
      />
      <ActivityContextRow
        carry={{
          slotsUsed: state.inventory.slotsUsed,
          slotsAvailable: state.inventory.slotsAvailable,
          massGrams: state.inventory.massGrams,
          capacityGrams: state.inventory.capacityGrams,
        }}
        items={[]}
      />
    </ActivityPanel>
  );
}
