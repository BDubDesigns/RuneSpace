import { describe, expect, it } from "vitest";
import { createDialogueExportPayload } from "@/tools/qc-studio/core/export";
import {
  createSnapshotHistory,
  pushSnapshot,
  redoSnapshot,
  undoSnapshot,
} from "@/tools/qc-studio/core/history";
import {
  addDurableCheckpoint,
  getDialogueStudioStorageKey,
  parsePersistedDialogueStudio,
  serializeDialogueStudio,
} from "@/tools/qc-studio/core/storage";
import { validateDialogueDraft } from "@/tools/qc-studio/core/validation";
import { createBlankDraft } from "@/tools/qc-studio/core/draft";
import type {
  DialogueAdapter,
  DialogueCheckpoint,
  DialogueDraft,
} from "@/tools/qc-studio/core/types";

const adapter: DialogueAdapter = {
  adapterId: "test-game",
  displayName: "Test Game",
  npcs: [
    {
      id: "npc_one",
      displayName: "One",
      role: "Test speaker",
      expressions: [{ id: "neutral", label: "Neutral", asset: "/one.png" }],
    },
  ],
  backgrounds: [{ id: "background_one", label: "One", asset: "/one.png", alt: "One" }],
  sequences: [],
  isValidStableId: (value) => /^[a-z][a-z0-9_]*$/.test(value),
};

function draft(overrides: Partial<DialogueDraft> = {}): DialogueDraft {
  return {
    schemaVersion: 1,
    adapterId: adapter.adapterId,
    draftId: "draft-1",
    title: "Test dialogue",
    npcId: "npc_one",
    beats: [
      {
        speakerNpcId: "npc_one",
        expressionId: "neutral",
        backgroundId: "background_one",
        presentationMode: "local",
        text: "Hello.",
      },
    ],
    ...overrides,
  };
}

describe("QC Studio core", () => {
  it("supports conventional undo and redo snapshots", () => {
    const first = createSnapshotHistory("first");
    const second = pushSnapshot(first, "second");
    const third = pushSnapshot(second, "third");
    expect(undoSnapshot(third).present).toBe("second");
    expect(redoSnapshot(undoSnapshot(third)).present).toBe("third");
  });

  it("validates speaker-expression compatibility and text requirements", () => {
    const result = validateDialogueDraft(
      adapter,
      draft({
        beats: [
          {
            speakerNpcId: "npc_one",
            expressionId: "missing",
            backgroundId: "background_one",
            presentationMode: "local",
            text: "",
          },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual([
      "beats.0.expressionId",
      "beats.0.text",
    ]);
  });

  it("keeps only the latest five complete durable checkpoints", () => {
    let checkpoints: DialogueCheckpoint[] = [];
    for (let index = 1; index <= 6; index += 1) {
      checkpoints = addDurableCheckpoint(
        checkpoints,
        draft({ title: `Draft ${index}` }),
        `Checkpoint ${index}`,
        `2026-08-24T00:00:0${index}.000Z`,
        `checkpoint-${index}`,
      );
    }
    expect(checkpoints).toHaveLength(5);
    expect(checkpoints[0]?.label).toBe("Checkpoint 2");
    expect(checkpoints.at(-1)?.draft.title).toBe("Draft 6");
  });

  it("fails safely for unsupported persisted schema versions", () => {
    expect(
      parsePersistedDialogueStudio(
        JSON.stringify({ schemaVersion: 2, adapterId: adapter.adapterId }),
        adapter.adapterId,
      ),
    ).toEqual({ kind: "unsupported" });
  });

  it("scopes the dialogue storage key to the adapter", () => {
    expect(getDialogueStudioStorageKey(adapter.adapterId)).toBe("qc-studio:test-game:dialogue:v1");
  });

  it("names blank drafts from the default speaker and background context", () => {
    expect(createBlankDraft(adapter, "blank-1").title).toBe("One — One Dialogue");
  });

  it("round-trips a versioned draft and its complete checkpoints", () => {
    const checkpoints = addDurableCheckpoint(
      [],
      draft(),
      "Manual Save",
      "2026-08-24T00:00:00.000Z",
      "checkpoint-1",
    );
    const result = parsePersistedDialogueStudio(
      serializeDialogueStudio(draft(), checkpoints),
      adapter.adapterId,
    );
    expect(result.kind).toBe("loaded");
    if (result.kind === "loaded") {
      expect(result.state.draft.beats[0]?.text).toBe("Hello.");
      expect(result.state.checkpoints).toHaveLength(1);
    }
  });

  it("exports source identity and a complete structured draft without publishing", () => {
    const payload = createDialogueExportPayload(
      adapter.adapterId,
      draft({ sourceSequenceId: "source_one" }),
    );
    expect(payload.qcStudio).toEqual({
      schemaVersion: 1,
      module: "dialogue",
      adapterId: "test-game",
    });
    expect(payload.source).toEqual({ kind: "authoritative_sequence", sequenceId: "source_one" });
    expect(payload.sequence.beats[0]?.text).toBe("Hello.");
  });
});
