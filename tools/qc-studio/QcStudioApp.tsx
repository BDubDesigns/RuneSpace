"use client";

import { DialogueStudio } from "./modules/dialogue/DialogueStudio";
import { RuneSpaceDialoguePreview } from "./adapters/runespace/RuneSpaceDialoguePreview";
import { runespaceDialogueAdapter } from "./adapters/runespace/dialogue-adapter";

export function QcStudioApp() {
  return (
    <DialogueStudio adapter={runespaceDialogueAdapter} renderPreview={RuneSpaceDialoguePreview} />
  );
}
