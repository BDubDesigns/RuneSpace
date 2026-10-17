"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { GAME_TICK_MS } from "@/game/config/foundations";
import type { PlayGameplayState } from "@/server/play";

function secondsForTicks(ticks: number) {
  return (ticks * GAME_TICK_MS) / 1_000;
}

/**
 * The equipped Mining tool's on-demand details inside the selected slot's panel
 * (#364): Power Cell charge, boosted attempts, the tool's own timing effects and
 * Load Power Cell. Whichever authored Cutter is equipped supplies the numbers
 * (#233); the Salvage Cutter is one such tool, never the rule.
 */
export function EquipmentToolDetails({
  tool,
  carriedPowerCellQuantity,
  loadBusy,
  loadDisabled,
  onLoadPowerCell,
}: {
  tool: NonNullable<PlayGameplayState["equipment"]["miningTool"]>;
  carriedPowerCellQuantity: number;
  loadBusy: boolean;
  loadDisabled: boolean;
  onLoadPowerCell: () => void;
}) {
  return (
    <div
      className="border-t border-[color:var(--rs-border-subtle)] pt-3"
      data-equipped-mining-tool={tool.itemId}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
          Power Cell charge
        </p>
        <p className="text-sm text-[color:var(--rs-text-secondary)]">
          {tool.currentCharge > 0 ? "Loaded · " : "Depleted · "}
          {tool.currentCharge} / {tool.maximumCharge}
        </p>
      </div>
      <div className="mt-2">
        <StatusMeter
          label="Boosted attempts"
          value={(tool.currentCharge / tool.maximumCharge) * 100}
          detail={`${tool.currentCharge} remaining`}
        />
      </div>
      {tool.baseDurationMultiplierBps !== 10_000 ? (
        // Only a tool whose own definition changes the base
        // duration says so; the Salvage Cutter's 1.00× does not.
        <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
          Normal attempt: {tool.attemptDurationTicks} ticks /{" "}
          {secondsForTicks(tool.attemptDurationTicks)} seconds (
          {tool.baseDurationMultiplierBps / 10_000}× base time, charged or not)
        </p>
      ) : null}
      {tool.chargedEffect.kind === "speed" ? (
        <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
          Boosted attempt: {tool.boostedAttemptDurationTicks} ticks /{" "}
          {secondsForTicks(tool.boostedAttemptDurationTicks)} seconds
        </p>
      ) : (
        // A tool whose charge buys ore says so, and that its
        // attempts are no faster for it (#233).
        <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
          While charged: +{tool.chargedEffect.units} ore on any attempt that yields ore · attempt
          time unchanged
        </p>
      )}
      {!tool.usable ? (
        <Feedback tone="danger">Requires Mining {tool.requiredMiningLevel} to use.</Feedback>
      ) : null}
      <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
        Carried Power Cells: {carriedPowerCellQuantity}
      </p>
      {tool.currentCharge > 0 ? (
        <Feedback>
          Power Cell already loaded — {tool.currentCharge} boosted attempts remain.
        </Feedback>
      ) : carriedPowerCellQuantity > 0 ? (
        <ActionButton
          className="mt-3"
          disabled={loadDisabled}
          intent="mining"
          loading={loadBusy}
          onClick={onLoadPowerCell}
        >
          Load Power Cell
        </ActionButton>
      ) : (
        <Feedback>No loose Power Cells are carried.</Feedback>
      )}
    </div>
  );
}
