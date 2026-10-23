import { describe, expect, it } from "vitest";
import { runespaceDialogueAdapter } from "@/tools/qc-studio/adapters/runespace/dialogue-adapter";
import { validateDialogueDraft } from "@/tools/qc-studio/core/validation";
import { createDraftFromAdapterSequence } from "@/tools/qc-studio/core/draft";
import { DIALOGUE_IDS } from "@/game/config/foundations";

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

  it("labels local conversation backgrounds by their actual Local Places", () => {
    const label = (id: string) =>
      runespaceDialogueAdapter.backgrounds.find((bg) => bg.id === id)?.label;
    expect(label("last_leg_trading_interior")).toBe("Last Leg Trading");
    expect(label("hh_bnb_interior")).toBe("HH B&B");
    expect(label("crash_site_exterior")).toBe("Crash Site");
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

  it("lists skill-level variants as ordinary sequences and leaves out a choice with no beats of its own (#391)", () => {
    const ids = new Set(runespaceDialogueAdapter.sequences.map((sequence) => sequence.id));
    expect(ids.has(DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice)).toBe(true);
    expect(ids.has(DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced)).toBe(true);
    // The lesson keeps its own beats, so it stays editable.
    expect(ids.has(DIALOGUE_IDS.wiseOldEnbyFirstLesson)).toBe(true);
    expect(ids.has(DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic)).toBe(false);
  });
});
