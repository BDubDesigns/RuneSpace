"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { AttuneMode } from "@/features/runeworking/AttuneMode";
import { RuneworkingRecipesCatalog } from "@/features/runeworking/RuneworkingRecipesCatalog";
import { runeworkingResultLine } from "@/features/runeworking/rig-copy";
import { usePlay } from "@/features/play/PlayContext";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import type { RuneworkingRunState } from "@/server/runeworking";

type RigMode = "attune" | "recipes";

const MODE_TITLES: Record<RigMode, string> = {
  attune: "Attune",
  recipes: "Recipes",
};

/**
 * The Wise Old Enby's Resonance Rig at Hilltop Workshop (#391): Attune, where a
 * cycle is started and watched, beside Recipes, the read-only reference of the
 * Runeworking recipes the character has learned.
 *
 * It is the place's activity, so it renders below the Enby's own card (the
 * Location surface composes residents first, `docs/npc-conversations.md`) and
 * never needs them: talking to the Enby and using the Rig are separate.
 *
 * Before Not From Around Here is complete the Rig is scenery: nothing renders.
 */
export function ResonanceRig() {
  const { state } = usePlay();
  const rig = state.resonanceRig;
  const [mode, setMode] = useState<RigMode>("attune");
  const beat = useRigResultBeat(state.characterId, rig.run);

  // Whatever is actually on the Rig is what the Rig shows.
  const onRig = rig.cycle !== undefined;
  useEffect(() => {
    if (onRig) setMode("attune");
  }, [onRig]);

  if (!rig.unlocked) return null;

  // What the Rig works with: each recipe's inputs, then what it makes.
  const contextItems = [
    ...new Set(
      rig.recipes.flatMap((recipe) => [
        ...recipe.inputs.map((each) => each.itemId),
        recipe.outputItemId,
      ]),
    ),
  ].map((itemId) => ({
    label: resolveItemPresentation(itemId, itemId).displayName,
    quantity: state.carriedByItemId[itemId] ?? 0,
  }));

  return (
    <ActivityPanel
      data-resonance-rig
      data-rig-mode={mode}
      eyebrow="Resonance Rig"
      title={MODE_TITLES[mode]}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Resonance Rig mode">
        {(["attune", "recipes"] as const).map((candidate) => (
          <ActionButton
            aria-pressed={mode === candidate}
            data-rig-mode-select={candidate}
            intent={mode === candidate ? "primary" : "secondary"}
            key={candidate}
            onClick={() => setMode(candidate)}
          >
            {MODE_TITLES[candidate]}
          </ActionButton>
        ))}
      </div>

      {beat ? (
        <div
          className="border-l-2 bg-[color:var(--rs-surface-panel)] px-3 py-2"
          data-rig-result
          role="status"
          style={{ borderColor: "var(--rs-skill-runeworking)" }}
        >
          <p
            className="font-display text-sm font-bold uppercase tracking-wide"
            data-rig-result-headline
            style={{ color: "var(--rs-skill-runeworking)" }}
          >
            {beat.headline}
          </p>
          <p className="text-xs text-[color:var(--rs-text-secondary)]">{beat.details}</p>
        </div>
      ) : null}

      {mode === "recipes" ? <RuneworkingRecipesCatalog /> : <AttuneMode />}

      <SkillProgressRow
        level={state.runeworking.level}
        skill="Runeworking"
        tone="runeworking"
        xpIntoLevel={state.runeworking.xpIntoLevel}
        {...(state.runeworking.xpToNextLevel === undefined
          ? {}
          : { xpToNextLevel: state.runeworking.xpToNextLevel })}
      />
      <ActivityContextRow
        carry={{
          slotsUsed: state.inventory.slotsUsed,
          slotsAvailable: state.inventory.slotsAvailable,
          massGrams: state.inventory.massGrams,
          capacityGrams: state.inventory.capacityGrams,
        }}
        items={contextItems}
      />
    </ActivityPanel>
  );
}

/**
 * The newly completed part of the run since this surface last looked, as one
 * line. A first look only records a baseline; a fresh Start (the run reset)
 * clears the line. Presentation only: every figure is the run's own counters.
 */
function useRigResultBeat(characterId: string, run: RuneworkingRunState) {
  const seen = useRef<{ characterId: string; run: RuneworkingRunState } | undefined>(undefined);
  const [beat, setBeat] = useState<ReturnType<typeof runeworkingResultLine>>();
  const newest = run.recentCycles.at(-1);
  const key = `${characterId}:${run.cycles}:${newest?.sequence ?? 0}:${newest?.resolvedAt ?? ""}`;
  useEffect(() => {
    const previous = seen.current?.characterId === characterId ? seen.current.run : undefined;
    seen.current = { characterId, run };
    if (!previous) return;
    if (run.cycles < previous.cycles) {
      setBeat(undefined);
      return;
    }
    const outputs = Object.fromEntries(
      Object.entries(run.outputsGained).map(([itemId, quantity]) => [
        itemId,
        quantity - (previous.outputsGained[itemId] ?? 0),
      ]),
    );
    const next = runeworkingResultLine({
      cycles: run.cycles - previous.cycles,
      outputs,
      xp: run.xpGained - previous.xpGained,
      nameOf: (itemId) => resolveItemPresentation(itemId, itemId).displayName,
    });
    if (next) setBeat(next);
    // `key` captures every change to the run that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return beat;
}
