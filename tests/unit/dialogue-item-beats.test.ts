import { describe, expect, it } from "vitest";
import {
  DIALOGUE_SEQUENCES,
  getDialogue,
  resolveDialogueItem,
  resolveDialogueSpeaker,
} from "@/game/content/dialogue";
import { DIALOGUE_ITEM_CATALOG, getItemBeatQuantityRange } from "@/game/content/item-presentation";
import { DIALOGUE_IDS, ITEM_IDS, NPC_IDS } from "@/game/config/foundations";

describe("dialogue item beats", () => {
  it("keeps every authored beat a valid single-subject NPC or item beat", () => {
    for (const sequence of DIALOGUE_SEQUENCES) {
      for (const beat of sequence.beats) {
        if (beat.kind === "npc") {
          expect(resolveDialogueSpeaker(beat)).toBeDefined();
        } else {
          const resolved = resolveDialogueItem(beat);
          expect(resolved).toBeDefined();
          const range = getItemBeatQuantityRange(beat.itemId);
          expect(range).toBeDefined();
          expect(beat.quantity).toBeGreaterThanOrEqual(range!.min);
          expect(beat.quantity).toBeLessThanOrEqual(range!.max);
        }
      }
    }
  });

  it("presents the Cutter as the first post-claim beat before Tansy speaks again", () => {
    const afterClaim = getDialogue(DIALOGUE_IDS.tansyAfterClaim);
    expect(afterClaim).toBeDefined();
    const [firstBeat, secondBeat] = afterClaim!.beats;
    expect(firstBeat?.kind).toBe("item");
    expect(firstBeat).toMatchObject({ itemId: ITEM_IDS.salvageCutter, quantity: 1 });
    expect(secondBeat).toMatchObject({ kind: "npc", speakerNpcId: NPC_IDS.tansyRusk });
  });

  it("never shows the Cutter reveal in capacity-refusal dialogue", () => {
    for (const dialogueId of [DIALOGUE_IDS.tansyCapacitySlots, DIALOGUE_IDS.tansyCapacityMass]) {
      const sequence = getDialogue(dialogueId);
      expect(sequence?.beats.every((beat) => beat.kind === "npc")).toBe(true);
    }
  });

  it("fails safe on unknown item IDs and NPC beats", () => {
    expect(
      resolveDialogueItem({
        kind: "item",
        itemId: "not_a_real_item" as ItemIdCast,
        quantity: 1,
        backgroundId: "the_jag_exterior",
        text: "",
      }),
    ).toBeUndefined();
    expect(
      resolveDialogueItem({
        kind: "npc",
        speakerNpcId: NPC_IDS.tansyRusk,
        expressionId: "neutral",
        backgroundId: "the_jag_exterior",
        presentationMode: "local",
        text: "",
      }),
    ).toBeUndefined();
    expect(
      resolveDialogueSpeaker({
        kind: "item",
        itemId: ITEM_IDS.salvageCutter,
        quantity: 1,
        backgroundId: "the_jag_exterior",
        text: "",
      }),
    ).toBeUndefined();
  });

  it("derives quantity ranges from the authoritative item definitions", () => {
    expect(getItemBeatQuantityRange(ITEM_IDS.ferriteShale)).toEqual({ min: 1, max: 10 });
    expect(getItemBeatQuantityRange(ITEM_IDS.salvageCutter)).toEqual({ min: 1, max: 1 });
    expect(getItemBeatQuantityRange("not_a_real_item")).toBeUndefined();
  });

  it("exposes only items that have authoritative inventory definitions", () => {
    const catalogIds = DIALOGUE_ITEM_CATALOG.map((item) => item.id);
    expect(catalogIds).toContain(ITEM_IDS.salvageCutter);
    expect(catalogIds).toContain(ITEM_IDS.ferriteShale);
    // crash-grade structural alloy has presentation data but no inventory definition
    expect(catalogIds).not.toContain(ITEM_IDS.crashGradeStructuralAlloy);
    for (const item of DIALOGUE_ITEM_CATALOG) {
      expect(getItemBeatQuantityRange(item.id)).toBeDefined();
    }
  });
});

type ItemIdCast = Parameters<typeof getItemBeatQuantityRange>[0] extends never ? never : string;
