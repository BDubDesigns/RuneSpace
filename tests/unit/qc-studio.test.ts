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
import { createBlankDraft, createBeatForSubject } from "@/tools/qc-studio/core/draft";
import type {
  DialogueAdapter,
  DialogueCheckpoint,
  DialogueDraft,
  StudioDialogueBeat,
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
  skills: [{ id: "test_skill", displayName: "Test Skill" }],
  sequences: [],
  isValidStableId: (value) => /^[a-z][a-z0-9_]*$/.test(value),
};

function draft(overrides: Partial<DialogueDraft> = {}): DialogueDraft {
  return {
    schemaVersion: 3,
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

function skillXpBeat() {
  return {
    kind: "skill_xp",
    skillId: "test_skill",
    amount: 100,
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
        JSON.stringify({ schemaVersion: 4, adapterId: adapter.adapterId }),
        adapter.adapterId,
      ),
    ).toEqual({ kind: "unsupported" });
  });

  it("scopes the dialogue storage key to the adapter and bumps to v3", () => {
    expect(getDialogueStudioStorageKey(adapter.adapterId)).toBe("qc-studio:test-game:dialogue:v3");
    expect(getLegacyDialogueStudioStorageKey(adapter.adapterId)).toBe(
      "qc-studio:test-game:dialogue:v2",
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
      expect(result.state.draft.schemaVersion).toBe(3);
      expect(result.state.draft.beats[0]).toMatchObject({ kind: "npc", text: "Legacy line." });
      expect(result.state.checkpoints[0]?.draft.beats[0]?.kind).toBe("npc");
    }
  });

  it("migrates v2 drafts (with item beats) forward without rewriting beat kinds", () => {
    const v2Payload = {
      schemaVersion: 2,
      adapterId: adapter.adapterId,
      draft: {
        schemaVersion: 2,
        adapterId: adapter.adapterId,
        draftId: "draft-v2",
        title: "V2 draft",
        npcId: "npc_one",
        beats: [itemBeat()],
      },
      checkpoints: [],
    };
    const result = parsePersistedDialogueStudio(JSON.stringify(v2Payload), adapter.adapterId);
    expect(result.kind).toBe("migrated");
    if (result.kind === "migrated") {
      expect(result.state.draft.schemaVersion).toBe(3);
      expect(result.state.draft.beats[0]).toEqual(itemBeat());
    }
  });

  it("exports source identity and a complete structured draft without publishing", () => {
    const payload = createDialogueExportPayload(
      adapter.adapterId,
      draft({ sourceSequenceId: "source_one", beats: [itemBeat()] }),
    );
    expect(payload.qcStudio).toEqual({
      schemaVersion: 3,
      module: "dialogue",
      adapterId: "test-game",
    });
    expect(payload.source).toEqual({ kind: "authoritative_sequence", sequenceId: "source_one" });
    expect(payload.sequence.beats[0]).toEqual(itemBeat());
  });

  it("validates skill-XP beats against the canonical skill registry and positive amounts", () => {
    const valid = validateDialogueDraft(adapter, draft({ beats: [skillXpBeat()] }));
    expect(valid.valid).toBe(true);

    const unknownSkill = validateDialogueDraft(
      adapter,
      draft({ beats: [{ ...skillXpBeat(), skillId: "not_real" }] }),
    );
    expect(unknownSkill.issues.map((issue) => issue.path)).toEqual(["beats.0.skillId"]);

    for (const amount of [0, -5, 1.5, Number.NaN]) {
      const invalidAmount = validateDialogueDraft(
        adapter,
        draft({
          beats: [{ ...skillXpBeat(), amount }],
        }),
      );
      expect(invalidAmount.issues.map((issue) => issue.path)).toEqual(["beats.0.amount"]);
    }
  });

  it("rejects mixed skill-XP shapes in validation and persisted state", () => {
    // Skill-XP beat carrying item-only fields.
    const mixedValidation = validateDialogueDraft(
      adapter,
      draft({
        beats: [
          {
            ...skillXpBeat(),
            itemId: "stack_thing",
            quantity: 2,
          } as unknown as DialogueDraft["beats"][number],
        ],
      }),
    );
    expect(mixedValidation.valid).toBe(false);
    expect(mixedValidation.issues.map((issue) => issue.path)).toContain("beats.0.subject");

    const mixedPersisted = parsePersistedDialogueStudio(
      JSON.stringify({
        schemaVersion: 3,
        adapterId: adapter.adapterId,
        draft: {
          schemaVersion: 3,
          adapterId: adapter.adapterId,
          draftId: "draft-mixed",
          title: "Mixed",
          npcId: "npc_one",
          beats: [{ ...skillXpBeat(), quantity: 3 }],
        },
        checkpoints: [],
      }),
      adapter.adapterId,
    );
    expect(mixedPersisted.kind).toBe("invalid");
  });

  it("rejects malformed mixed beat shapes in draft validation", () => {
    // Item beat carrying NPC-only fields. Cast through unknown: the malformed
    // shape is exactly what the validator must reject at runtime.
    const itemWithNpcFields = validateDialogueDraft(
      adapter,
      draft({
        beats: [
          {
            ...itemBeat(),
            speakerNpcId: "npc_one",
            expressionId: "neutral",
            presentationMode: "local",
          } as unknown as StudioDialogueBeat,
        ],
      }),
    );
    expect(itemWithNpcFields.valid).toBe(false);
    expect(itemWithNpcFields.issues.map((issue) => issue.path)).toEqual(["beats.0.subject"]);
    expect(itemWithNpcFields.issues[0]?.message).toContain("foreign subject fields");

    // Item beat with just one stale NPC field is also rejected.
    const itemWithOneStale = validateDialogueDraft(
      adapter,
      draft({
        beats: [{ ...itemBeat(), presentationMode: "comms" } as unknown as StudioDialogueBeat],
      }),
    );
    expect(itemWithOneStale.issues.map((issue) => issue.path)).toEqual(["beats.0.subject"]);

    // NPC beat carrying item-only fields.
    const npcWithItemFields = validateDialogueDraft(
      adapter,
      draft({
        beats: [
          {
            kind: "npc",
            speakerNpcId: "npc_one",
            expressionId: "neutral",
            backgroundId: "background_one",
            presentationMode: "local",
            text: "Hello.",
            itemId: "stack_thing",
            quantity: 2,
          } as unknown as StudioDialogueBeat,
        ],
      }),
    );
    expect(npcWithItemFields.valid).toBe(false);
    expect(npcWithItemFields.issues.map((issue) => issue.path)).toEqual(["beats.0.subject"]);
    expect(npcWithItemFields.issues[0]?.message).toContain("foreign subject fields");

    // Clean beats of each kind remain valid.
    expect(validateDialogueDraft(adapter, draft({ beats: [itemBeat()] })).valid).toBe(true);
    expect(validateDialogueDraft(adapter, draft()).valid).toBe(true);
  });

  it("fails safely when persisted state contains mixed beat shapes", () => {
    // A v2 payload whose item beat secretly carries NPC-only fields must be
    // treated as invalid, never loaded as if clean.
    const mixedItemPayload = {
      schemaVersion: 2,
      adapterId: adapter.adapterId,
      draft: {
        schemaVersion: 2,
        adapterId: adapter.adapterId,
        draftId: "draft-mixed",
        title: "Mixed item beat",
        npcId: "npc_one",
        beats: [{ ...itemBeat(), speakerNpcId: "npc_one" }],
      },
      checkpoints: [],
    };
    expect(
      parsePersistedDialogueStudio(JSON.stringify(mixedItemPayload), adapter.adapterId),
    ).toEqual({ kind: "invalid" });

    // Same for an NPC beat carrying item-only fields.
    const mixedNpcPayload = {
      schemaVersion: 2,
      adapterId: adapter.adapterId,
      draft: {
        schemaVersion: 2,
        adapterId: adapter.adapterId,
        draftId: "draft-mixed-npc",
        title: "Mixed npc beat",
        npcId: "npc_one",
        beats: [
          {
            kind: "npc",
            speakerNpcId: "npc_one",
            expressionId: "neutral",
            backgroundId: "background_one",
            presentationMode: "local",
            text: "Hello.",
            itemId: "stack_thing",
            quantity: 1,
          },
        ],
      },
      checkpoints: [],
    };
    expect(
      parsePersistedDialogueStudio(JSON.stringify(mixedNpcPayload), adapter.adapterId),
    ).toEqual({ kind: "invalid" });

    // And a legacy v1-shaped beat with item fields fails migration instead of
    // being adopted as a clean NPC beat.
    const mixedV1Payload = {
      schemaVersion: 1,
      adapterId: adapter.adapterId,
      draft: {
        schemaVersion: 1,
        adapterId: adapter.adapterId,
        draftId: "draft-v1-mixed",
        title: "Mixed v1 beat",
        npcId: "npc_one",
        beats: [
          {
            speakerNpcId: "npc_one",
            expressionId: "neutral",
            backgroundId: "background_one",
            presentationMode: "local",
            text: "Legacy.",
            itemId: "stack_thing",
            quantity: 1,
          },
        ],
      },
      checkpoints: [],
    };
    expect(parsePersistedDialogueStudio(JSON.stringify(mixedV1Payload), adapter.adapterId)).toEqual(
      { kind: "invalid" },
    );
  });

  it("replaces the whole beat shape on NPC → Item → NPC switches", () => {
    // Start from an NPC beat carrying distinctive values that must NOT survive.
    const npcStart = {
      kind: "npc",
      speakerNpcId: "npc_one",
      expressionId: "neutral",
      backgroundId: "background_one",
      presentationMode: "comms" as const,
      text: "Distinctive NPC line.",
    };

    // NPC → Item: the item beat must contain ONLY item-kind fields.
    const asItem = createBeatForSubject(adapter, "item", npcStart.backgroundId);
    expect(Object.keys(asItem).sort()).toEqual([
      "backgroundId",
      "itemId",
      "kind",
      "quantity",
      "text",
    ]);
    expect(asItem).toEqual({
      kind: "item",
      itemId: "stack_thing",
      quantity: 1,
      backgroundId: "background_one",
      text: "",
    });
    expect("speakerNpcId" in asItem).toBe(false);
    expect("expressionId" in asItem).toBe(false);
    expect("presentationMode" in asItem).toBe(false);

    // Item → NPC: the npc beat must contain ONLY npc-kind fields.
    const backToNpc = createBeatForSubject(adapter, "npc", npcStart.backgroundId);
    expect(Object.keys(backToNpc).sort()).toEqual([
      "backgroundId",
      "expressionId",
      "kind",
      "presentationMode",
      "speakerNpcId",
      "text",
    ]);
    expect("itemId" in backToNpc).toBe(false);
    expect("quantity" in backToNpc).toBe(false);

    // Both directions gate through live-adapter validation. The fresh NPC
    // beat carries no line yet, so its ONLY issue is empty text — proving the
    // shape itself introduces no cross-kind problems.
    expect(validateDialogueDraft(adapter, draft({ beats: [asItem] })).valid).toBe(true);
    const npcValidation = validateDialogueDraft(adapter, draft({ beats: [backToNpc] }));
    expect(npcValidation.issues.map((issue) => issue.path)).toEqual(["beats.0.text"]);
  });

  it("persists and exports only valid fields for the active kind after subject switching", () => {
    const switchedDraft = draft({
      title: "Switched subjects",
      beats: [
        // Simulates a UI NPC→Item switch: wholesale replacement, no merge.
        { ...itemBeat() },
        // Simulates a stale-field hazard: an item beat that previously was an
        // NPC beat. The persisted/exported shape must not carry NPC fields.
        { ...itemBeat(), itemId: "unique_thing", quantity: 1, text: "Look at this." },
      ],
    });

    // Persisted round-trip: storage accepts both kinds and returns exactly the
    // fields each kind defines — no cross-kind leakage in or out.
    const stored = parsePersistedDialogueStudio(
      serializeDialogueStudio(switchedDraft, []),
      adapter.adapterId,
    );
    expect(stored.kind).toBe("loaded");
    if (stored.kind !== "loaded") return;
    const [persistedItem, persistedFormerNpc] = stored.state.draft.beats;
    expect(Object.keys(persistedFormerNpc!).sort()).toEqual([
      "backgroundId",
      "itemId",
      "kind",
      "quantity",
      "text",
    ]);
    expect(persistedItem).toEqual(itemBeat());

    // Exported shape: same guarantee, deterministic itemId + quantity only.
    const payload = createDialogueExportPayload(adapter.adapterId, stored.state.draft);
    expect(payload.sequence.beats[0]).toEqual(itemBeat());
    expect(payload.sequence.beats[1]).toEqual({
      kind: "item",
      itemId: "unique_thing",
      quantity: 1,
      backgroundId: "background_one",
      text: "Look at this.",
    });

    // Validation still gates unknown/invalid shapes after the switch path.
    expect(validateDialogueDraft(adapter, stored.state.draft).valid).toBe(true);
  });
});
