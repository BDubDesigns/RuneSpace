import { skillLevelThresholds } from "@/game/config/balance";
import {
  getDialogue,
  getSkillLevelDialogue,
  SKILL_LEVEL_DIALOGUES,
  type DialogueSequence,
  type SkillLevelDialogue,
} from "@/game/content/dialogue";
import { STARTING_LEVEL } from "@/game/domain/character-progression";

/**
 * Skill-level-dependent dialogue (#391): the one rule that picks which variant
 * of an authored choice (`SKILL_LEVEL_DIALOGUES`) a character hears, and the
 * one place a sequence that invokes a choice is turned into the beats played.
 *
 * Authority: the server runs `selectSkillLevelDialogues` against the character's
 * persisted XP inside every Play state (`PlayGameplayState.skillLevelDialogue`).
 * The conversation surface only plays what that map names, so no React
 * component holds a threshold, a skill check or an NPC-specific condition.
 * Nothing is persisted and nothing is granted: the choice is presentation.
 */

/** A character's level in each skill; an absent skill is at the starting level. */
export type SkillLevels = Readonly<Record<string, number>>;

/** The variant `dialogue` selects at these levels: the highest threshold reached. */
export function selectSkillLevelDialogueVariant(
  dialogue: SkillLevelDialogue,
  skillLevels: SkillLevels,
): string {
  const level = skillLevels[dialogue.skillId] ?? STARTING_LEVEL;
  let selected = dialogue.variants[0]!.dialogueId;
  for (const variant of dialogue.variants) {
    if (level >= variant.minimumLevel) selected = variant.dialogueId;
  }
  return selected;
}

/** Every authored choice resolved for one character, keyed by its stable ID. */
export function selectSkillLevelDialogues(
  skillLevels: SkillLevels,
  dialogues: readonly SkillLevelDialogue[] = SKILL_LEVEL_DIALOGUES,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    dialogues.map((dialogue) => [
      dialogue.id,
      selectSkillLevelDialogueVariant(dialogue, skillLevels),
    ]),
  );
}

/**
 * The sequence as it is played: its own beats, then — when it invokes a
 * skill-level choice — the beats of the variant the server selected. A choice
 * the map does not name (a state from before the choice existed) plays its
 * Level 1 fallback, never nothing.
 */
export function resolvePresentedDialogue(
  dialogueId: string,
  selections: Readonly<Record<string, string>>,
): DialogueSequence | undefined {
  const sequence = getDialogue(dialogueId);
  if (!sequence?.skillLevelDialogueId) return sequence;
  const choice = getSkillLevelDialogue(sequence.skillLevelDialogueId);
  if (!choice) return sequence;
  const variant = getDialogue(selections[choice.id] ?? choice.variants[0]!.dialogueId);
  return variant ? { ...sequence, beats: [...sequence.beats, ...variant.beats] } : sequence;
}

/**
 * Startup validation: fail fast at module load so an authoring mistake never
 * reaches a player as a silent or wrong branch.
 */
export function validateSkillLevelDialogues(
  sequences: readonly DialogueSequence[],
  dialogues: readonly SkillLevelDialogue[] = SKILL_LEVEL_DIALOGUES,
): void {
  const ids = new Set<string>();
  for (const dialogue of dialogues) {
    const where = `Skill-level dialogue "${dialogue.id}"`;
    if (ids.has(dialogue.id)) throw new Error(`${where} is declared more than once.`);
    ids.add(dialogue.id);
    const thresholds = skillLevelThresholds(dialogue.skillId);
    if (!thresholds) throw new Error(`${where} names a skill with no level curve.`);
    const maximum = thresholds[thresholds.length - 1]!.level;
    if (dialogue.variants.length < 2) throw new Error(`${where} must offer at least two variants.`);
    if (dialogue.variants[0]!.minimumLevel !== STARTING_LEVEL) {
      throw new Error(`${where} must start with a Level ${STARTING_LEVEL} fallback variant.`);
    }
    let previous = 0;
    for (const variant of dialogue.variants) {
      if (!Number.isInteger(variant.minimumLevel) || variant.minimumLevel <= previous) {
        throw new Error(`${where} thresholds must be whole levels in ascending order.`);
      }
      if (variant.minimumLevel > maximum) {
        throw new Error(`${where} threshold ${variant.minimumLevel} is above the skill's maximum.`);
      }
      previous = variant.minimumLevel;
      const sequence = getDialogue(variant.dialogueId);
      if (!sequence) throw new Error(`${where} names unknown dialogue "${variant.dialogueId}".`);
      if (sequence.npcId !== dialogue.npcId) {
        throw new Error(`${where} variant "${variant.dialogueId}" belongs to another NPC.`);
      }
      if (sequence.beats.length === 0 || sequence.skillLevelDialogueId) {
        throw new Error(`${where} variant "${variant.dialogueId}" must be ordinary beats.`);
      }
    }
  }
  for (const sequence of sequences) {
    if (!sequence.skillLevelDialogueId) {
      if (sequence.beats.length === 0) {
        throw new Error(`Dialogue "${sequence.id}" has no beats.`);
      }
      continue;
    }
    const choice = dialogues.find((dialogue) => dialogue.id === sequence.skillLevelDialogueId);
    if (!choice) {
      throw new Error(
        `Dialogue "${sequence.id}" invokes unknown skill-level dialogue "${sequence.skillLevelDialogueId}".`,
      );
    }
    if (choice.npcId !== sequence.npcId) {
      throw new Error(`Dialogue "${sequence.id}" invokes another NPC's skill-level dialogue.`);
    }
  }
}
