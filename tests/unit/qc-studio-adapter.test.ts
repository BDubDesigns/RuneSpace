import { describe, expect, it } from "vitest";
import { runespaceDialogueAdapter } from "@/tools/qc-studio/adapters/runespace/dialogue-adapter";
import { validateDialogueDraft } from "@/tools/qc-studio/core/validation";
import { createDraftFromAdapterSequence } from "@/tools/qc-studio/core/draft";

describe("RuneSpace QC Studio adapter", () => {
  it("translates the complete authored dialogue catalog into valid Studio input", () => {
    expect(runespaceDialogueAdapter.adapterId).toBe("runespace");
    expect(runespaceDialogueAdapter.sequences.length).toBeGreaterThan(1);
    for (const sequence of runespaceDialogueAdapter.sequences) {
      const draft = createDraftFromAdapterSequence(
        runespaceDialogueAdapter,
        sequence,
        `draft-${sequence.id}`,
      );
      expect(validateDialogueDraft(runespaceDialogueAdapter, draft)).toMatchObject({ valid: true });
    }
  });

  it("only exposes expressions authored for each RuneSpace NPC", () => {
    // An NPC whose conversation content is not authored yet legitimately has no
    // expression art; every NPC who actually speaks must have some.
    const speakers = new Set(
      runespaceDialogueAdapter.sequences.flatMap((sequence) =>
        sequence.beats.flatMap((beat) => (beat.kind === "npc" ? [beat.speakerNpcId] : [])),
      ),
    );
    for (const npc of runespaceDialogueAdapter.npcs) {
      if (speakers.has(npc.id)) expect(npc.expressions.length).toBeGreaterThan(0);
      for (const expression of npc.expressions) {
        expect(expression.asset).toMatch(/^\/npc-art\//);
      }
    }
  });
});
