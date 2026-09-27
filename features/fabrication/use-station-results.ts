"use client";

import { useEffect, useRef, useState } from "react";
import {
  fabricationResultBeat,
  observationKey,
  observeFabricationRun,
  observeTinkeringRun,
  tinkeringResultBeat,
  type FabricationObservation,
  type StationObservation,
  type StationResultBeat,
  type TinkeringObservation,
} from "@/features/fabrication/station-results";
import type { FabricationRunState } from "@/server/fabrication";
import type { TinkeringRunState } from "@/server/tinkering";

const storageKey = (characterId: string, kind: StationObservation["kind"]) =>
  `runespace:station-observed:${kind}:${characterId}`;

function readStored<T extends StationObservation>(key: string, kind: T["kind"]): T | undefined {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as T | null;
    return parsed?.kind === kind ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, observation: StationObservation) {
  try {
    window.localStorage.setItem(key, JSON.stringify(observation));
  } catch {
    // Presentation only: without storage the next visit simply starts fresh.
  }
}

/**
 * One run's newly observed outcomes as a beat. The last observation is kept
 * per character on this device, so outcomes that resolved while the station
 * was closed — offline, or a Max run finishing elsewhere — arrive as one
 * aggregated beat on return. A first-ever visit only records a baseline.
 */
function useRunBeat<O extends StationObservation, R>(
  characterId: string,
  kind: O["kind"],
  run: R,
  observe: (run: R) => O,
  beatFrom: (previous: O, run: R) => StationResultBeat | undefined,
  onBeat: (beat: StationResultBeat | undefined) => void,
) {
  const observed = useRef<O | undefined>(undefined);
  const current = observe(run);
  const key = observationKey(current);
  useEffect(() => {
    const store = storageKey(characterId, kind);
    const previous = observed.current ?? readStored<O>(store, kind);
    const next = observe(run);
    if (previous && observationKey(previous) !== observationKey(next)) {
      // A reset with nothing new (a fresh Start) clears the previous beat.
      onBeat(beatFrom(previous, run));
    }
    observed.current = next;
    writeStored(store, next);
    // `key` captures every change to the run that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, kind, key]);
}

/** The most recent beat from either side of the station. */
export function useStationResultBeat(
  characterId: string,
  fabricationRun: FabricationRunState,
  tinkeringRun: TinkeringRunState,
): StationResultBeat | undefined {
  const [beat, setBeat] = useState<StationResultBeat>();
  useRunBeat<FabricationObservation, FabricationRunState>(
    characterId,
    "fabrication",
    fabricationRun,
    observeFabricationRun,
    fabricationResultBeat,
    setBeat,
  );
  useRunBeat<TinkeringObservation, TinkeringRunState>(
    characterId,
    "tinkering",
    tinkeringRun,
    observeTinkeringRun,
    tinkeringResultBeat,
    setBeat,
  );
  return beat;
}
