"use client";

import { StatusMeter } from "@/components/ui/StatusMeter";
import { skillAccentColor } from "@/components/ui/skill-accent";
import type { CharacterSkillProgression } from "@/game/domain/character-progression";

/**
 * One character's skills with their current level and progress through it
 * (#213).
 *
 * The same-location player inspector and the current-character Character
 * modal are two real consumers of exactly one presentation, so it lives here
 * rather than being interpreted twice. It renders whatever the canonical
 * cross-skill projection presents, in the order it presents it: there is no
 * skill list, no per-skill branch, and no level or XP arithmetic here beyond
 * the meter's own percentage, so a skill added to the game appears on both
 * surfaces with no change to either.
 *
 * The primary progression number is deliberately the current level and the XP
 * remaining in it — "how far am I through this level" — with the lifetime
 * total kept as secondary detail.
 */
export function CharacterSkillList({
  skills,
  className = "",
}: {
  skills: readonly CharacterSkillProgression[];
  className?: string;
}) {
  return (
    <ul className={`space-y-3 ${className}`}>
      {skills.map((skill) => {
        const accent = skillAccentColor(skill.accentTone);
        return (
          <li className="min-w-0" data-character-skill key={skill.displayName}>
            <p
              className="font-display text-sm font-bold"
              style={{ color: accent ?? "var(--rs-text-primary)" }}
            >
              {skill.displayName} — Level {skill.level}
            </p>
            {skill.xpToNextLevel === undefined ? (
              <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
                Maximum level reached — {skill.totalXp.toLocaleString()} total XP
              </p>
            ) : (
              <div className="mt-1">
                <StatusMeter
                  accentColor={accent}
                  detail={`${skill.xpToNextLevel} XP to next level`}
                  label={`${skill.displayName} XP`}
                  value={Math.min(
                    100,
                    (skill.xpIntoLevel / (skill.xpIntoLevel + skill.xpToNextLevel)) * 100,
                  )}
                />
                <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
                  {skill.totalXp.toLocaleString()} total XP · {skill.xpIntoLevel} XP into this level
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
