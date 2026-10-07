"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { AdminTotalXpSchema } from "@/game/schemas/admin";
import { adminSetSkillXp } from "@/server/admin-actions";
import { ConfirmAction } from "./ConfirmAction";
import { skillLabel, xpSettableSkills } from "./admin-format";
import { controlClass, Field, Section, type AdminTabProps } from "./AdminParts";

/**
 * Skills tab (#333): every presented skill's total XP, level and progress, with
 * the SET TOTAL XP control that changes them.
 */
export function AdminSkillsTab(props: AdminTabProps) {
  const { characterId, characterName, play, applyState, refreshAll, bus } = props;
  const xpSkills = xpSettableSkills();
  const [skillId, setSkillId] = useState<string>(xpSkills[0]?.skillId ?? "");
  const [value, setValue] = useState("0");
  const [pending, setPending] = useState(false);

  async function setXp() {
    const parsedXp = AdminTotalXpSchema.safeParse(Number(value));
    if (!parsedXp.success) return bus("Total XP must be a non-negative integer.", "danger");
    const parsed = parsedXp.data;
    setPending(true);
    try {
      const response = await adminSetSkillXp({ characterId, skillId, totalXp: parsed });
      if ("error" in response) return bus(response.error, "danger");
      if (response.outcome.kind === "set") {
        applyState(response.state);
        await refreshAll();
        bus(
          `Set ${skillLabel(response.outcome.skillId)} XP to ${response.outcome.after} (was ${response.outcome.before}).`,
          "success",
        );
      } else {
        applyState(response.state);
        bus(`No change; ${skillLabel(skillId)} is already there.`, "muted");
      }
    } finally {
      setPending(false);
    }
  }

  const currentInSkill = play.skillTotalXp[skillId] ?? 0;
  const parsedForConfirm = AdminTotalXpSchema.safeParse(Number(value));
  const differs = parsedForConfirm.success && parsedForConfirm.data !== currentInSkill;

  return (
    <div className="space-y-4">
      <Section title="Skills">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {play.progression.skills.map((skill) => (
            <Field key={skill.displayName} label={skill.displayName}>
              {skill.totalXp} XP · level {skill.level}
              <span className="block text-xs text-[color:var(--rs-text-muted)]">
                {skill.xpIntoLevel}
                {skill.xpToNextLevel !== undefined
                  ? ` / ${skill.xpToNextLevel} into next level`
                  : ""}
              </span>
            </Field>
          ))}
        </dl>
      </Section>

      <Section title="Skill total XP">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 basis-40 text-xs text-[color:var(--rs-text-muted)]">
            <span className="block uppercase tracking-wide">Skill</span>
            <select
              className={controlClass}
              value={skillId}
              onChange={(event) => setSkillId(event.target.value)}
            >
              {xpSkills.map(({ skillId: id, displayName }) => (
                <option key={id} value={id}>
                  {displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="w-full text-xs text-[color:var(--rs-text-muted)] sm:w-32">
            <span className="block uppercase tracking-wide">Total XP</span>
            <input
              className={controlClass}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              inputMode="numeric"
            />
          </label>
          {differs ? (
            <ConfirmAction
              label="Set"
              confirmLabel="Confirm set"
              intent="secondary"
              prompt={`Set ${skillLabel(skillId)} total XP for "${characterName}" from ${currentInSkill} to ${differs ? parsedForConfirm.data : value}.`}
              onConfirm={setXp}
            />
          ) : (
            <ActionButton intent="secondary" loading={pending} onClick={setXp}>
              Set
            </ActionButton>
          )}
        </div>
      </Section>
    </div>
  );
}
