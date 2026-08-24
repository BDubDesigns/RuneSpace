export const QC_STUDIO_SCHEMA_VERSION = 1 as const;

export type StudioDialoguePresentationMode = "local" | "comms";
export type StudioDialogueAction = "accept_mission" | "complete_mission";

export type StudioDialogueBeat = {
  speakerNpcId: string;
  expressionId: string;
  backgroundId: string;
  presentationMode: StudioDialoguePresentationMode;
  text: string;
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
