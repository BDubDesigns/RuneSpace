"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { MissionGuidanceHalo, missionGuidanceClassName } from "@/components/ui/MissionGuidanceHalo";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { FabricateMode } from "@/features/fabrication/FabricateMode";
import { RecipesCatalog } from "@/features/fabrication/RecipesCatalog";
import { TinkerMode } from "@/features/fabrication/TinkerMode";
import type { StationResultBeat } from "@/features/fabrication/station-results";
import { useStationResultBeat } from "@/features/fabrication/use-station-results";
import { usePlay } from "@/features/play/PlayContext";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";

type StationMode = "fabricate" | "tinker" | "recipes";

const MODE_TITLES: Record<StationMode, string> = {
  fabricate: "Fabricate",
  tinker: "Tinker",
  recipes: "Recipes",
};

/**
 * Rusk Recovery's Fabrication Station (#232): Fabricate, and — once Tansy's
 * Return the Favor demonstration has shown it — Tinker, as two modes of one
 * station, beside Recipes, the read-only reference of what the character
 * knows. Manual Override is not a mode; it lives inside Fabricate.
 *
 * Newly resolved outcomes from either side show as one inline result beat.
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
  const beat = useStationResultBeat(state.characterId, station.run, tinkering.run);

  // Whatever is actually on the station is what the station shows.
  const onMachine = station.workpiece !== undefined;
  useEffect(() => {
    if (onMachine) setMode("fabricate");
  }, [onMachine]);
  useEffect(() => {
    if (tinkering.active) setMode("tinker");
  }, [tinkering.active]);

  if (!station.unlocked) return null;
  const shownMode: StationMode = mode === "tinker" && !tinkering.unlocked ? "fabricate" : mode;

  return (
    <ActivityPanel
      eyebrow="Fabrication Station"
      title={MODE_TITLES[shownMode]}
      data-fabrication-station
      data-station-mode={shownMode}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Fabrication Station mode">
        <ActionButton
          aria-pressed={shownMode === "fabricate"}
          data-station-mode-select="fabricate"
          intent={shownMode === "fabricate" ? "primary" : "secondary"}
          onClick={() => setMode("fabricate")}
        >
          Fabricate
        </ActionButton>
        {tinkering.unlocked ? (
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
        ) : null}
        <ActionButton
          aria-pressed={shownMode === "recipes"}
          data-station-mode-select="recipes"
          intent={shownMode === "recipes" ? "primary" : "secondary"}
          onClick={() => setMode("recipes")}
        >
          Recipes
        </ActionButton>
      </div>

      {beat ? <ResultBeat beat={beat} /> : null}

      {shownMode === "tinker" ? (
        <TinkerMode />
      ) : shownMode === "recipes" ? (
        <RecipesCatalog />
      ) : (
        <FabricateMode />
      )}

      <SkillProgressRow
        level={state.fabrication.level}
        skill="Fabrication"
        tone="fabrication"
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

/**
 * The inline result beat: already-resolved outcomes, acknowledged where the
 * player is looking. A bust keeps its own danger treatment.
 */
function ResultBeat({ beat }: { beat: StationResultBeat }) {
  const accent = beat.tone === "bust" ? "var(--rs-accent-danger)" : "var(--rs-skill-fabrication)";
  return (
    <div
      className="border-l-2 bg-[color:var(--rs-surface-panel)] px-3 py-2"
      data-station-result={beat.tone}
      data-station-result-kind={beat.kind}
      role="status"
      style={{ borderColor: accent }}
    >
      <p
        className="font-display text-sm font-bold uppercase tracking-wide"
        data-station-result-headline
        style={{ color: accent }}
      >
        {beat.headline}
      </p>
      <p className="text-xs text-[color:var(--rs-text-secondary)]" data-station-result-details>
        {beat.details.join(" · ")}
      </p>
    </div>
  );
}
