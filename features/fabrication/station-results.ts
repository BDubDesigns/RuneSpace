import { resolveItemPresentation } from "@/game/content/item-presentation";
import { manualOverrideMultiplierLabel } from "@/game/domain/manual-override";
import type { FabricationRunState } from "@/server/fabrication";
import type { TinkeringRunState } from "@/server/tinkering";

/**
 * The station's inline result beat (#232 human-preview follow-up): a compact
 * acknowledgement of outcomes the server has already resolved, derived by
 * comparing what the client last observed of a run with what it observes now.
 *
 * It is presentation only. Every figure comes from the authoritative run
 * counters, so however many workpieces or batches resolved before the client
 * looked — one live, or a whole Max run offline — they arrive as one
 * aggregated beat, never a burst of messages.
 */

type NewestRecord = { sequence: number; resolvedAt: string };

export type FabricationObservation = {
  kind: "fabrication";
  batches: number;
  successes: number;
  busts: number;
  xpGained: number;
  outputsGained: Readonly<Record<string, number>>;
  newest?: NewestRecord;
};

export type TinkeringObservation = {
  kind: "tinkering";
  batches: number;
  xpGained: number;
  scrapKept: number;
  scrapDiscarded: number;
  newest?: NewestRecord;
};

export type StationObservation = FabricationObservation | TinkeringObservation;

export type StationResultBeat = {
  kind: "fabrication" | "tinkering";
  /** `bust` only when nothing in the observed outcomes succeeded. */
  tone: "success" | "mixed" | "bust";
  headline: string;
  details: readonly string[];
};

function newestOf(records: readonly NewestRecord[]): NewestRecord | undefined {
  const last = records.at(-1);
  return last ? { sequence: last.sequence, resolvedAt: last.resolvedAt } : undefined;
}

export function observeFabricationRun(run: FabricationRunState): FabricationObservation {
  const newest = newestOf(run.recentWorkpieces);
  return {
    kind: "fabrication",
    batches: run.batches,
    successes: run.successes,
    busts: run.busts,
    xpGained: run.xpGained,
    outputsGained: run.outputsGained,
    ...(newest ? { newest } : {}),
  };
}

export function observeTinkeringRun(run: TinkeringRunState): TinkeringObservation {
  const newest = newestOf(run.recentBatches);
  return {
    kind: "tinkering",
    batches: run.batches,
    xpGained: run.xpGained,
    scrapKept: run.scrapKept,
    scrapDiscarded: run.scrapDiscarded,
    ...(newest ? { newest } : {}),
  };
}

/** Identity for "has anything changed": a run only moves by resolving or resetting. */
export function observationKey(observation: StationObservation): string {
  return `${observation.kind}:${observation.batches}:${observation.newest?.sequence ?? 0}:${observation.newest?.resolvedAt ?? ""}`;
}

/**
 * Whether `next` continues the run `previous` saw. A workpiece's sequence is
 * its position in its run, so the record `previous` saw last is still that
 * record — same sequence, same resolution time — unless a new run replaced it.
 * Once it has scrolled out of the bounded history, only a continuing run can
 * have pushed it out.
 */
function continuesRun(
  previous: StationObservation,
  next: StationObservation,
  retained: readonly NewestRecord[],
): boolean {
  if (next.batches < previous.batches) return false;
  if (!previous.newest) return true;
  const same = retained.find((record) => record.sequence === previous.newest!.sequence);
  return !same || same.resolvedAt === previous.newest.resolvedAt;
}

const count = (quantity: number, name: string) => (quantity > 1 ? `${quantity} × ${name}` : name);

export function fabricationResultBeat(
  previous: FabricationObservation,
  run: FabricationRunState,
): StationResultBeat | undefined {
  const next = observeFabricationRun(run);
  const base: Omit<FabricationObservation, "kind" | "newest"> = continuesRun(
    previous,
    next,
    run.recentWorkpieces,
  )
    ? previous
    : { batches: 0, successes: 0, busts: 0, xpGained: 0, outputsGained: {} };
  const batches = next.batches - base.batches;
  if (batches <= 0) return undefined;
  const successes = next.successes - base.successes;
  const busts = next.busts - base.busts;
  const xp = next.xpGained - base.xpGained;
  const made = Object.entries(next.outputsGained)
    .map(([itemId, quantity]) => [itemId, quantity - (base.outputsGained[itemId] ?? 0)] as const)
    .filter(([, quantity]) => quantity > 0)
    .map(
      ([itemId, quantity]) =>
        `${count(quantity, resolveItemPresentation(itemId, itemId).displayName)} fabricated`,
    );
  const bust = busts > 0 ? `${count(busts, "Workpiece")} bust · materials lost` : undefined;
  const newest = run.recentWorkpieces.at(-1);
  const override =
    batches === 1 && successes === 1 && newest?.result === "success" && newest.usedOverride
      ? `Manual Override ${manualOverrideMultiplierLabel(newest)}`
      : undefined;
  const headline = made.length > 0 ? made.join(" · ") : (bust ?? "Workpiece resolved");
  return {
    kind: "fabrication",
    tone: successes === 0 ? "bust" : busts > 0 ? "mixed" : "success",
    headline,
    details: [
      ...(made.length > 0 && bust ? [bust] : []),
      ...(override ? [override] : []),
      xp > 0 ? `+${xp} Fabrication XP` : "No XP",
    ],
  };
}

export function tinkeringResultBeat(
  previous: TinkeringObservation,
  run: TinkeringRunState,
): StationResultBeat | undefined {
  const next = observeTinkeringRun(run);
  const base = continuesRun(previous, next, run.recentBatches)
    ? previous
    : { batches: 0, xpGained: 0, scrapKept: 0, scrapDiscarded: 0 };
  const batches = next.batches - base.batches;
  const newest = run.recentBatches.at(-1);
  if (batches <= 0 || !newest) return undefined;
  // A Tinkering run takes apart one target, so its newest batch names it.
  const name = resolveItemPresentation(newest.itemId, newest.itemId).displayName;
  const kept = next.scrapKept - base.scrapKept;
  const discarded = next.scrapDiscarded - base.scrapDiscarded;
  const xp = next.xpGained - base.xpGained;
  return {
    kind: "tinkering",
    tone: "success",
    headline: `${count(newest.quantity * batches, name)} dismantled`,
    details: [
      ...(kept > 0 ? [`+${kept} Scrap Metal`] : []),
      ...(discarded > 0 ? [`${discarded} Scrap discarded`] : []),
      `+${xp} Fabrication XP`,
    ],
  };
}
