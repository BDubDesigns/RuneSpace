import { DialogueScene } from "@/features/dialogue/DialogueScene";
import { toRuneSpaceDialogueBeat } from "./dialogue-adapter";
import type { DialoguePreviewProps } from "../../modules/dialogue/DialogueStudio";

/** Adapter-owned preview bridge: QC Studio supplies draft state, while the
 * production RuneSpace scene owns the actual visual presentation. */
export function RuneSpaceDialoguePreview({ beat, ...props }: DialoguePreviewProps) {
  return <DialogueScene {...props} beat={toRuneSpaceDialogueBeat(beat)} />;
}
