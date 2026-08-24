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
  getLegacyDialogueStudioStorageKey,
  parsePersistedDialogueStudio,
  serializeDialogueStudio,
} from "@/tools/qc-studio/core/storage";
import {
  getStudioItemQuantityRange,
  validateDialogueDraft,
} from "@/tools/qc-studio/core/validation";
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
  items: [
    { id: "stack_thing", displayName: "Stack Thing", kind: "stack", stackLimit: 4 },
    { id: "unique_thing", displayName: "Unique Thing", kind: "unique" },
  ],
  sequences: [],
  isValidStableId: (value) => /^[a-z][a-z0-9_]*$/.test(value),
};

function draft(overrides: Partial<DialogueDraft> = {}): DialogueDraft {
  return {
    schemaVersion: 2,
    adapterId: adapter.adapterId,
    draftId: "draft-1",
    title: "Test dialogue",
    npcId: "npc_one",
    beats: [
      {
        kind: "npc",
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

function itemBeat() {
  return {
    kind: "item",
    itemId: "stack_thing",
    quantity: 2,
    backgroundId: "background_one",
    text: "",
  } as const;
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
            kind: "npc",
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

  it("validates item beats against the authoritative catalog and quantity range", () => {
    const valid = validateDialogueDraft(adapter, draft({ beats: [itemBeat()] }));
    expect(valid.valid).toBe(true);

    const unknownItem = validateDialogueDraft(
      adapter,
      draft({ beats: [{ ...itemBeat(), itemId: "not_real" }] }),
    );
    expect(unknownItem.issues.map((issue) => issue.path)).toEqual(["beats.0.itemId"]);

    const outOfRange = validateDialogueDraft(
      adapter,
      draft({ beats: [{ ...itemBeat(), quantity: 5 }] }),
    );
    expect(outOfRange.issues.map((issue) => issue.path)).toEqual(["beats.0.quantity"]);

    const nonInteger = validateDialogueDraft(
      adapter,
      draft({ beats: [{ ...itemBeat(), quantity: 1.5 }] }),
    );
    expect(nonInteger.issues.map((issue) => issue.path)).toEqual(["beats.0.quantity"]);

    const uniqueLocked = validateDialogueDraft(
      adapter,
      draft({ beats: [{ ...itemBeat(), itemId: "unique_thing", quantity: 1 }] }),
    );
    expect(uniqueLocked.valid).toBe(true);
    const uniqueOver = validateDialogueDraft(
      adapter,
      draft({ beats: [{ ...itemBeat(), itemId: "unique_thing", quantity: 2 }] }),
    );
    expect(uniqueOver.issues.map((issue) => issue.path)).toEqual(["beats.0.quantity"]);
  });

  it("allows item beats with empty captions while NPC beats require text", () => {
    const result = validateDialogueDraft(adapter, draft({ beats: [{ ...itemBeat(), text: "" }] }));
    expect(result.valid).toBe(true);
  });

  it("derives quantity ranges only from the item definition", () => {
    expect(
      getStudioItemQuantityRange({
        id: "stack_thing",
        displayName: "s",
        kind: "stack",
        stackLimit: 9,
      }),
    ).toEqual({
      min: 1,
      max: 9,
    });
    expect(
      getStudioItemQuantityRange({ id: "unique_thing", displayName: "u", kind: "unique" }),
    ).toEqual({
      min: 1,
      max: 1,
    });
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
        JSON.stringify({ schemaVersion: 3, adapterId: adapter.adapterId }),
        adapter.adapterId,
      ),
    ).toEqual({ kind: "unsupported" });
  });

  it("scopes the dialogue storage key to the adapter and bumps to v2", () => {
    expect(getDialogueStudioStorageKey(adapter.adapterId)).toBe("qc-studio:test-game:dialogue:v2");
    expect(getLegacyDialogueStudioStorageKey(adapter.adapterId)).toBe(
      "qc-studio:test-game:dialogue:v1",
    );
  });

  it("names blank drafts from the default speaker and background context", () => {
    expect(createBlankDraft(adapter, "blank-1").title).toBe("One — One Dialogue");
    expect(createBlankDraft(adapter, "blank-1").beats[0]?.kind).toBe("npc");
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

  it("migrates legacy v1 drafts by tagging every beat as an NPC beat", () => {
    const v1Payload = {
      schemaVersion: 1,
      adapterId: adapter.adapterId,
      draft: {
        schemaVersion: 1,
        adapterId: adapter.adapterId,
        draftId: "draft-old",
        title: "Old draft",
        npcId: "npc_one",
        beats: [
          {
            speakerNpcId: "npc_one",
            expressionId: "neutral",
            backgroundId: "background_one",
            presentationMode: "local",
            text: "Legacy line.",
          },
        ],
      },
      checkpoints: [
        {
          id: "checkpoint-old",
          label: "Manual Save",
          savedAt: "2026-08-20T00:00:00.000Z",
          draft: {
            schemaVersion: 1,
            adapterId: adapter.adapterId,
            draftId: "draft-old",
            title: "Old checkpoint",
            npcId: "npc_one",
            beats: [
              {
                speakerNpcId: "npc_one",
                expressionId: "neutral",
                backgroundId: "background_one",
                presentationMode: "local",
                text: "Checkpoint line.",
              },
            ],
          },
        },
      ],
    };
    const result = parsePersistedDialogueStudio(JSON.stringify(v1Payload), adapter.adapterId);
    expect(result.kind).toBe("migrated");
    if (result.kind === "migrated") {
      expect(result.state.draft.schemaVersion).toBe(2);
      expect(result.state.draft.beats[0]).toMatchObject({ kind: "npc", text: "Legacy line." });
      expect(result.state.checkpoints[0]?.draft.beats[0]?.kind).toBe("npc");
    }
  });

  it("exports source identity and a complete structured draft without publishing", () => {
    const payload = createDialogueExportPayload(
      adapter.adapterId,
      draft({ sourceSequenceId: "source_one", beats: [itemBeat()] }),
    );
    expect(payload.qcStudio).toEqual({
      schemaVersion: 2,
      module: "dialogue",
      adapterId: "test-game",
    });
    expect(payload.source).toEqual({ kind: "authoritative_sequence", sequenceId: "source_one" });
    expect(payload.sequence.beats[0]).toEqual(itemBeat());
  });
});
