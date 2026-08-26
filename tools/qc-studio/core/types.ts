export const QC_STUDIO_SCHEMA_VERSION = 3 as const;

/** The last schema version this build can migrate from. */
export const QC_STUDIO_MIGRATABLE_SCHEMA_VERSION = 2 as const;

export type StudioDialoguePresentationMode = "local" | "comms";
export type StudioDialogueAction = "accept_mission" | "complete_mission";

/**
 * A beat presents exactly one visual subject: an NPC portrait, an item
 * reveal, or a skill-XP reward tile. Item and skill-XP beats are
 * presentation only — authoring or exporting one is never authorization to
 * grant items or progression.
 */
export type StudioDialogueBeat =
  | {
      kind: "npc";
      speakerNpcId: string;
      expressionId: string;
      backgroundId: string;
      presentationMode: StudioDialoguePresentationMode;
      text: string;
    }
  | {
      kind: "item";
      itemId: string;
      /** Display quantity only; constrained by the adapter's authoritative definition. */
      quantity: number;
      backgroundId: string;
      text: string;
    }
  | {
      kind: "skill_xp";
      skillId: string;
      /** Display amount only; a positive integer authored against the adapter catalog. */
      amount: number;
      backgroundId: string;
      text: string;
    };

export type StudioItem =
  | { id: string; displayName: string; kind: "stack"; stackLimit: number }
  | { id: string; displayName: string; kind: "unique" };

/** Canonical skill identity a game adapter can expose for skill-XP beats. */
export type StudioSkill = {
  id: string;
  displayName: string;
};

export type StudioDialogueSequence = {
  id: string;
  title: string;
  npcId: string;
  beats: readonly StudioDialogueBeat[];
  action?: StudioDialogueAction;
};

export type StudioNpcExpression = {
  id: string;
  label: string;
  asset: string;
};

export type StudioNpc = {
  id: string;
  displayName: string;
  role: string;
  expressions: readonly StudioNpcExpression[];
};

export type StudioConversationBackground = {
  id: string;
  label: string;
  asset: string;
  alt: string;
};

/**
 * The smallest contract a game adapter needs to expose to Dialogue Studio.
 * The core only knows these neutral concepts; RuneSpace-specific definitions
 * stay in adapters/runespace.
 */
export type DialogueAdapter = {
  adapterId: string;
  displayName: string;
  npcs: readonly StudioNpc[];
  backgrounds: readonly StudioConversationBackground[];
  items?: readonly StudioItem[];
  skills?: readonly StudioSkill[];
  sequences: readonly StudioDialogueSequence[];
  isValidStableId?: (value: string) => boolean;
};

export type DialogueDraft = {
  schemaVersion: typeof QC_STUDIO_SCHEMA_VERSION;
  adapterId: string;
  draftId: string;
  title: string;
  proposedStableId?: string;
  sourceSequenceId?: string;
  npcId: string;
  beats: StudioDialogueBeat[];
  action?: StudioDialogueAction;
};

export type DialogueCheckpoint = {
  id: string;
  label: string;
  savedAt: string;
  draft: DialogueDraft;
};

export type PersistedDialogueStudio = {
  schemaVersion: typeof QC_STUDIO_SCHEMA_VERSION;
  adapterId: string;
  draft: DialogueDraft;
  checkpoints: DialogueCheckpoint[];
};

export type DialogueValidationIssue = {
  path: string;
  message: string;
};

export type DialogueValidationResult = {
  valid: boolean;
  issues: DialogueValidationIssue[];
};
