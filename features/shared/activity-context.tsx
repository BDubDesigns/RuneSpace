"use client";

import { skillAccentColor, type SkillAccentTone } from "@/components/ui/skill-accent";
import { formatMassGrams } from "@/game/domain/mass";

/**
 * The compact context an activity carries beside its controls (#193).
 *
 * Both rows replace cards that cost far more height than the handful of numbers
 * they showed: the skill card was 168px for a level, an XP figure and a meter,
 * and the Cargo readout 242px for a quantity, a slot count and a carried mass.
 * On a 390px screen that was 410px — more than half a viewport — of context
 * sitting between the player and the run summary for their current activity.
 *
 * Presentation only. Neither row reads authoritative state, computes anything,
 * or knows which activity is rendering it: the activity passes the numbers it
 * has already been given, and chooses which of them are worth a player's
 * attention while they are doing this particular thing. That choice is the
 * point — the full Inventory remains the detailed surface, and an activity
 * showing every fact it could reach would just rebuild the card these replace.
 */

/**
 * One line of skill progression: which skill, what level, how far to the next.
 *
 * `skill` is the skill's display name ("Mining"), so the meter's accessible
 * name stays the "<Skill> progression XP" that assistive technology and the
 * existing E2E coverage already know.
 */
export function SkillProgressRow({
  level,
  skill,
  tone,
  xpIntoLevel,
  xpToNextLevel,
}: {
  level: number;
  skill: string;
  tone: SkillAccentTone;
  xpIntoLevel: number;
  xpToNextLevel?: number;
}) {
  const accent = skillAccentColor(tone) ?? "var(--rs-accent-primary)";
  const percent = xpToNextLevel
    ? Math.min(100, (xpIntoLevel / (xpIntoLevel + xpToNextLevel)) * 100)
    : 100;
  return (
    <div className="min-w-0" data-skill-progress={skill.toLowerCase()}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p
          className="font-display text-xs font-bold uppercase tracking-[0.14em]"
          style={{ color: accent }}
        >
          {skill} Lv. {level}
        </p>
        <p className="text-xs text-[color:var(--rs-text-secondary)]">
          {xpToNextLevel ? `${xpToNextLevel.toLocaleString()} XP to next` : "Maximum level"}
        </p>
      </div>
      <div
        aria-label={`${skill} progression XP`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="mt-1.5 h-1 overflow-hidden bg-[color:var(--rs-border-subtle)]"
        role="progressbar"
      >
        <div className="h-full" style={{ background: accent, width: `${percent}%` }} />
      </div>
    </div>
  );
}

export type ActivityContextItem = {
  /** Item or resource display name, e.g. "Ferrite Shale". */
  label: string;
  quantity: number;
};

export type CarryContext = {
  slotsUsed: number;
  slotsAvailable: number;
  massGrams: number;
  capacityGrams: number;
};

/**
 * One line of the quantities an activity is actually working with, plus the
 * carrying limits that will stop it, when those limits are what stops it.
 *
 * An activity with nowhere to put its output (a repair, the Annex claim) passes
 * no `carry` and the line is just its materials.
 */
export function ActivityContextRow({
  carry,
  items,
}: {
  carry?: CarryContext;
  items: readonly ActivityContextItem[];
}) {
  if (items.length === 0 && !carry) return null;
  return (
    <p
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-[color:var(--rs-text-secondary)]"
      data-activity-context
    >
      {items.map((item) => (
        <span key={item.label}>
          <strong className="font-display text-[color:var(--rs-text-primary)]">
            {item.quantity.toLocaleString()}
          </strong>{" "}
          {item.label}
        </span>
      ))}
      {carry ? (
        <span data-activity-context-slots>
          <strong className="font-display text-[color:var(--rs-text-primary)]">
            {carry.slotsUsed}/{carry.slotsUsed + carry.slotsAvailable}
          </strong>{" "}
          slots
        </span>
      ) : null}
      {carry ? (
        <span data-activity-context-mass>
          <strong className="font-display text-[color:var(--rs-text-primary)]">
            {formatMassGrams(carry.massGrams)}
          </strong>{" "}
          / {formatMassGrams(carry.capacityGrams)}
        </span>
      ) : null}
    </p>
  );
}
