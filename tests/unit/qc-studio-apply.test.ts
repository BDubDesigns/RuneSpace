import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { format } from "prettier";
import { describe, expect, it } from "vitest";
import { DIALOGUE_IDS } from "@/game/config/foundations";
import { DIALOGUE_SEQUENCES } from "@/game/content/dialogue";
import { runespaceDialogueAdapter } from "@/tools/qc-studio/adapters/runespace/dialogue-adapter";
import {
  ApplyRefusal,
  RUNESPACE_SOURCE_CONSTANTS,
  applyDialogueExport,
  canonicalize,
  planDialogueApply,
  type ApplyIo,
} from "@/tools/qc-studio/adapters/runespace/dialogue-apply";
import { createDialogueExportPayload } from "@/tools/qc-studio/core/export";
import { createDraftFromAdapterSequence } from "@/tools/qc-studio/core/draft";
import type {
  DialogueAdapter,
  StudioDialogueBeat,
  StudioDialogueSequence,
} from "@/tools/qc-studio/core/types";

const ROOT = path.resolve(__dirname, "../..");
const DIALOGUE_FILE = path.join(ROOT, "game/content/dialogue.ts");
const REAL_SOURCE = readFileSync(DIALOGUE_FILE, "utf8");

// ---------------------------------------------------------------------------
// A small fixture dialogue file with the same shapes as game/content/dialogue.ts:
// helper functions, background aliases, a comment, a computed line, and a spread.
// ---------------------------------------------------------------------------

const FIXTURE_CONSTANTS = {
  NPC_IDS: { ann: "npc_ann", bob: "npc_bob" },
  EXPRESSION_IDS: { neutral: "neutral", happy: "happy" },
  ITEM_IDS: { widget: "widget" },
  SKILL_IDS: { mining: "mining" },
  CONVERSATION_BACKGROUND_IDS: { hall: "bg_hall", yard: "bg_yard" },
  DIALOGUE_IDS: {
    first: "first_seq",
    second: "second_seq",
    computed: "computed_seq",
    spread: "spread_seq",
    tie: "tie_seq",
  },
};

const FIXTURE_NAME = "fixture/dialogue.ts";
const RAW_FIXTURE_SOURCE = `
const PRICE = 5;
const hall = CONVERSATION_BACKGROUND_IDS.hall;
const yard = CONVERSATION_BACKGROUND_IDS.yard;

function annLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.ann,
    expressionId,
    backgroundId: hall,
    presentationMode: "local",
    text,
  };
}

function annComms(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.ann,
    expressionId,
    backgroundId: hall,
    presentationMode: "comms",
    text,
  };
}

function bobLocal(expressionId: ExpressionId, text: string): DialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: NPC_IDS.bob,
    expressionId,
    backgroundId: yard,
    presentationMode: "local",
    text,
  };
}

function itemBeat(itemId: ItemId, quantity: number, text = ""): DialogueBeat {
  return { kind: "item", itemId, quantity, backgroundId: hall, text };
}

function annSkillBeat(skillId: SkillId, amount: number): DialogueBeat {
  return { kind: "skill_xp", skillId, amount, backgroundId: hall, text: "" };
}

function rewardBeats(backgroundId: string): DialogueBeat[] {
  return [];
}

const dialogue = {
  [DIALOGUE_IDS.first]: {
    id: DIALOGUE_IDS.first,
    npcId: NPC_IDS.ann,
    beats: [
      annLocal(EXPRESSION_IDS.neutral, "One."),
      // A note about the middle beat.
      annLocal(EXPRESSION_IDS.happy, "Two."),
      annComms(EXPRESSION_IDS.neutral, "Three."),
      itemBeat(ITEM_IDS.widget, 2),
    ],
  },
  [DIALOGUE_IDS.second]: {
    id: DIALOGUE_IDS.second,
    npcId: NPC_IDS.bob,
    beats: [bobLocal(EXPRESSION_IDS.neutral, "Untouched.")],
  },
  [DIALOGUE_IDS.computed]: {
    id: DIALOGUE_IDS.computed,
    npcId: NPC_IDS.ann,
    beats: [
      annLocal(EXPRESSION_IDS.neutral, \`Costs \${PRICE}.\`),
      annLocal(EXPRESSION_IDS.happy, "Plain."),
    ],
  },
  [DIALOGUE_IDS.tie]: {
    id: DIALOGUE_IDS.tie,
    npcId: NPC_IDS.ann,
    beats: [
      annLocal(EXPRESSION_IDS.happy, "Alpha."),
      // A note about Beta.
      annLocal(EXPRESSION_IDS.happy, "Beta."),
      annLocal(EXPRESSION_IDS.happy, "Gamma."),
    ],
  },
  [DIALOGUE_IDS.spread]: {
    id: DIALOGUE_IDS.spread,
    npcId: NPC_IDS.ann,
    beats: [annLocal(EXPRESSION_IDS.neutral, "Before."), ...rewardBeats(hall)],
  },
} as const satisfies Record<DialogueId, DialogueSequence>;
`;

function ann(
  expressionId: string,
  text: string,
  presentationMode: "local" | "comms" = "local",
): StudioDialogueBeat {
  return {
    kind: "npc",
    speakerNpcId: "npc_ann",
    expressionId,
    backgroundId: "bg_hall",
    presentationMode,
    text,
  };
}
function widget(quantity: number, text = "", backgroundId = "bg_hall"): StudioDialogueBeat {
  return { kind: "item", itemId: "widget", quantity, backgroundId, text };
}

const FIRST_BEATS: StudioDialogueBeat[] = [
  ann("neutral", "One."),
  ann("happy", "Two."),
  ann("neutral", "Three.", "comms"),
  widget(2),
];

function fixtureSequences(first: StudioDialogueBeat[] = FIRST_BEATS): StudioDialogueSequence[] {
  return [
    { id: "first_seq", title: "First", npcId: "npc_ann", beats: first },
    {
      id: "second_seq",
      title: "Second",
      npcId: "npc_bob",
      beats: [
        {
          kind: "npc",
          speakerNpcId: "npc_bob",
          expressionId: "neutral",
          backgroundId: "bg_yard",
          presentationMode: "local",
          text: "Untouched.",
        },
      ],
    },
    {
      id: "computed_seq",
      title: "Computed",
      npcId: "npc_ann",
      beats: [ann("neutral", "Costs 5."), ann("happy", "Plain.")],
    },
    {
      id: "tie_seq",
      title: "Tie",
      npcId: "npc_ann",
      beats: [ann("happy", "Alpha."), ann("happy", "Beta."), ann("happy", "Gamma.")],
    },
    {
      id: "spread_seq",
      title: "Spread",
      npcId: "npc_ann",
      beats: [
        ann("neutral", "Before."),
        {
          kind: "item",
          itemId: "widget",
          quantity: 1,
          backgroundId: "bg_hall",
          text: "",
          isRewardTotal: true,
        },
      ],
    },
  ];
}

function spreadSequence(): StudioDialogueSequence {
  return fixtureSequences().find((sequence) => sequence.id === "spread_seq")!;
}

function fixtureAdapter(first?: StudioDialogueBeat[]): DialogueAdapter {
  return {
    adapterId: "runespace",
    displayName: "Fixture",
    npcs: [
      {
        id: "npc_ann",
        displayName: "Ann",
        role: "Speaker",
        expressions: [
          { id: "neutral", label: "Neutral", asset: "/a.png" },
          { id: "happy", label: "Happy", asset: "/b.png" },
        ],
      },
      {
        id: "npc_bob",
        displayName: "Bob",
        role: "Speaker",
        expressions: [{ id: "neutral", label: "Neutral", asset: "/c.png" }],
      },
    ],
    backgrounds: [
      { id: "bg_hall", label: "Hall", asset: "/h.png", alt: "Hall" },
      { id: "bg_yard", label: "Yard", asset: "/y.png", alt: "Yard" },
    ],
    items: [{ id: "widget", displayName: "Widget", kind: "stack", stackLimit: 5 }],
    skills: [{ id: "mining", displayName: "Mining" }],
    sequences: fixtureSequences(first),
  };
}

function exportText(
  sequenceId: string,
  beats: readonly StudioDialogueBeat[],
  overrides: { npcId?: string; extra?: Record<string, unknown> } = {},
): string {
  return JSON.stringify({
    qcStudio: { schemaVersion: 3, module: "dialogue", adapterId: "runespace" },
    source: { kind: "authoritative_sequence", sequenceId },
    sequence: {
      title: "Studio title",
      npcId: overrides.npcId ?? "npc_ann",
      beats,
      ...overrides.extra,
    },
  });
}

const formatFixture = (text: string) => format(text, { parser: "typescript", printWidth: 100 });
// Like dialogue.ts (enforced by `format:check`), the fixture is already Prettier-clean.
const FIXTURE_SOURCE = await formatFixture(RAW_FIXTURE_SOURCE);

async function planFixture(text: string, source = FIXTURE_SOURCE, adapter = fixtureAdapter()) {
  return planDialogueApply({
    exportText: text,
    sourceText: source,
    sourceFileName: FIXTURE_NAME,
    adapter,
    constants: FIXTURE_CONSTANTS,
    formatSource: formatFixture,
  });
}

async function changedSource(text: string): Promise<string> {
  const plan = await planFixture(text);
  if (plan.status !== "changed") throw new Error("expected a change");
  return plan.newSource;
}

async function refusal(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ApplyRefusal);
  return (error as ApplyRefusal).message;
}

/** Everything of `source` outside the `[DIALOGUE_IDS.<key>]: {...}` entry. */
function outsideEntry(source: string, key: string): string {
  const start = source.indexOf(`[DIALOGUE_IDS.${key}]: {`);
  expect(start).toBeGreaterThan(-1);
  const next = source.indexOf("\n  [DIALOGUE_IDS.", start + 1);
  const end = next === -1 ? source.indexOf("\n} as const", start) : next;
  return source.slice(0, start) + source.slice(end);
}

describe("QC Studio apply: valid application on a fixture", () => {
  it("edits only the changed argument and leaves everything else byte-identical", async () => {
    const formatted = await formatFixture(FIXTURE_SOURCE);
    const beats = [...FIRST_BEATS];
    beats[1] = ann("happy", "Two, revised.");
    const next = await changedSource(exportText("first_seq", beats));

    expect(next).toContain('annLocal(EXPRESSION_IDS.happy, "Two, revised.")');
    expect(next).toContain("// A note about the middle beat.");
    expect(outsideEntry(next, "first")).toBe(outsideEntry(formatted, "first"));
    expect(next.split("\n").filter((line, i) => line !== formatted.split("\n")[i])).toHaveLength(1);
  });

  it("re-registers an expression through the typed registry, not a string literal", async () => {
    const beats = [...FIRST_BEATS];
    beats[0] = ann("happy", "One.");
    expect(await changedSource(exportText("first_seq", beats))).toContain(
      'annLocal(EXPRESSION_IDS.happy, "One.")',
    );
  });

  it("switches to the matching helper when presentation mode changes", async () => {
    const beats = [...FIRST_BEATS];
    beats[0] = ann("neutral", "One.", "comms");
    expect(await changedSource(exportText("first_seq", beats))).toContain(
      'annComms(EXPRESSION_IDS.neutral, "One.")',
    );
  });

  it("inserts at the start, middle, and end, and deletes, using native helpers", async () => {
    const inserted: StudioDialogueBeat[] = [
      ann("happy", "Zero."),
      FIRST_BEATS[0]!,
      ann("neutral", "One and a half."),
      FIRST_BEATS[1]!,
      FIRST_BEATS[2]!,
      FIRST_BEATS[3]!,
      ann("neutral", "Five.", "comms"),
    ];
    const next = await changedSource(exportText("first_seq", inserted));
    expect(next).toContain('annLocal(EXPRESSION_IDS.happy, "Zero.")');
    expect(next).toContain('annLocal(EXPRESSION_IDS.neutral, "One and a half.")');
    expect(next).toContain('annComms(EXPRESSION_IDS.neutral, "Five.")');
    // Order is exactly the export's order.
    const order = ["Zero.", '"One."', "One and a half.", '"Two."', '"Three."', "widget", "Five."];
    const positions = order.map((needle) => next.indexOf(needle));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    const removed = await changedSource(
      exportText("first_seq", [FIRST_BEATS[0]!, FIRST_BEATS[1]!]),
    );
    expect(removed).not.toContain('"Three."');
    expect(removed).not.toContain("itemBeat(ITEM_IDS.widget, 2)");
    expect(removed).toContain("// A note about the middle beat.");
  });

  it("applies several independent changes in one export", async () => {
    const beats = [
      ann("neutral", "One, again."),
      FIRST_BEATS[1]!,
      widget(2),
      ann("happy", "New end."),
    ];
    const next = await changedSource(exportText("first_seq", beats));
    expect(next).toContain('"One, again."');
    expect(next).not.toContain('"Three."');
    expect(next).toContain('annLocal(EXPRESSION_IDS.happy, "New end.")');
  });

  it("writes item quantity, caption, and background overrides in the source's own patterns", async () => {
    const beats = [...FIRST_BEATS];
    beats[3] = widget(3, "Caption.");
    expect(await changedSource(exportText("first_seq", beats))).toContain(
      'itemBeat(ITEM_IDS.widget, 3, "Caption.")',
    );

    beats[3] = widget(2, "", "bg_yard");
    expect(await changedSource(exportText("first_seq", beats))).toMatch(
      /\{\s*\.\.\.itemBeat\(ITEM_IDS\.widget, 2\),\s*backgroundId: yard,?\s*\}/,
    );
  });

  it("emits a skill XP beat through a helper when one fits", async () => {
    const beats = [
      ...FIRST_BEATS,
      {
        kind: "skill_xp",
        skillId: "mining",
        amount: 50,
        backgroundId: "bg_hall",
        text: "",
      } as const,
    ];
    expect(await changedSource(exportText("first_seq", beats))).toContain(
      "annSkillBeat(SKILL_IDS.mining, 50)",
    );
  });

  it("allows non-text edits to a beat whose text is computed, but not text edits", async () => {
    const expression = [ann("happy", "Costs 5."), ann("happy", "Plain.")];
    const next = await changedSource(exportText("computed_seq", expression));
    expect(next).toContain("annLocal(EXPRESSION_IDS.happy, `Costs ${PRICE}.`)");

    const text = [ann("neutral", "Costs 6."), ann("happy", "Plain.")];
    expect(await refusal(planFixture(exportText("computed_seq", text)))).toMatch(
      /computed in source/,
    );
  });

  it("is idempotent: the applied export produces no further change", async () => {
    const beats = [...FIRST_BEATS];
    beats[1] = ann("happy", "Two, revised.");
    beats.push(ann("neutral", "Appended."));
    const text = exportText("first_seq", beats);
    const next = await changedSource(text);

    const again = await planFixture(text, next, fixtureAdapter(beats));
    expect(again.status).toBe("unchanged");
  });

  it("treats an export identical to the current sequence as no change without reading the source", async () => {
    const plan = await planFixture(exportText("first_seq", FIRST_BEATS), "not even typescript {{");
    expect(plan.status).toBe("unchanged");
  });

  it("ignores Studio-only title and terminal-control action, and says so", async () => {
    const plan = await planFixture(
      exportText("first_seq", FIRST_BEATS, { extra: { action: "accept_mission" } }),
    );
    expect(plan.status).toBe("unchanged");
    expect(plan.ignored.join("\n")).toMatch(/title/);
    expect(plan.ignored.join("\n")).toMatch(/accept_mission/);
  });
});

describe("QC Studio apply: refusals change nothing", () => {
  it("refuses unknown sequence IDs instead of creating content", async () => {
    expect(await refusal(planFixture(exportText("nope_seq", FIRST_BEATS)))).toMatch(
      /Unknown sequenceId "nope_seq"/,
    );
  });

  it("refuses malformed JSON, unsupported versions, wrong module/adapter, and new drafts", async () => {
    expect(await refusal(planFixture("{ nope"))).toMatch(/not valid JSON/);

    const valid = JSON.parse(exportText("first_seq", FIRST_BEATS)) as Record<
      string,
      Record<string, unknown>
    >;
    const withVersion = (schemaVersion: unknown) =>
      JSON.stringify({ ...valid, qcStudio: { ...valid.qcStudio, schemaVersion } });
    expect(await refusal(planFixture(withVersion(2)))).toMatch(
      /Unsupported export schemaVersion 2/,
    );
    expect(await refusal(planFixture(withVersion(4)))).toMatch(
      /Unsupported export schemaVersion 4/,
    );
    expect(await refusal(planFixture(withVersion(undefined)))).toMatch(/Unsupported export/);

    expect(
      await refusal(
        planFixture(JSON.stringify({ ...valid, qcStudio: { ...valid.qcStudio, module: "quest" } })),
      ),
    ).toMatch(/module/);
    expect(
      await refusal(
        planFixture(
          JSON.stringify({ ...valid, qcStudio: { ...valid.qcStudio, adapterId: "other" } }),
        ),
      ),
    ).toMatch(/adapterId "other"/);
    expect(
      await refusal(
        planFixture(
          JSON.stringify({
            ...valid,
            source: { kind: "new_draft", proposedStableId: "brand_new" },
          }),
        ),
      ),
    ).toMatch(/new_draft/);
    expect(
      await refusal(
        planFixture(JSON.stringify({ ...valid, source: { kind: "authoritative_sequence" } })),
      ),
    ).toMatch(/sequenceId/);
  });

  it("refuses unsupported beat kinds and unknown fields rather than guessing", async () => {
    const unknownKind = [{ kind: "sfx", cue: "boom" }] as unknown as StudioDialogueBeat[];
    expect(await refusal(planFixture(exportText("first_seq", unknownKind)))).toMatch(/kind/);

    const extraField = [{ ...FIRST_BEATS[0]!, mood: "sad" }] as unknown as StudioDialogueBeat[];
    expect(await refusal(planFixture(exportText("first_seq", extraField)))).toMatch(/mood/);

    const extraTop = exportText("first_seq", FIRST_BEATS, { extra: { reward: { credits: 500 } } });
    expect(await refusal(planFixture(extraTop))).toMatch(/reward/);

    const mixed = [{ ...widget(1), speakerNpcId: "npc_ann" }] as unknown as StudioDialogueBeat[];
    expect(await refusal(planFixture(exportText("first_seq", mixed)))).toMatch(/speakerNpcId/);
  });

  it("refuses content that fails Studio validation (unknown NPC, expression, item, quantity)", async () => {
    const badExpression = [ann("furious", "One.")];
    expect(await refusal(planFixture(exportText("first_seq", badExpression)))).toMatch(
      /expression/i,
    );
    const badItem = [{ ...widget(1), itemId: "gizmo" }];
    expect(await refusal(planFixture(exportText("first_seq", badItem)))).toMatch(/itemId/);
    const badQuantity = [widget(99)];
    expect(await refusal(planFixture(exportText("first_seq", badQuantity)))).toMatch(/quantity/);
    const badNpc = [{ ...ann("neutral", "One."), speakerNpcId: "npc_zed" }];
    expect(await refusal(planFixture(exportText("first_seq", badNpc)))).toMatch(/speaker/i);
  });

  it("refuses to change the sequence's NPC identity", async () => {
    const beats = [
      {
        kind: "npc",
        speakerNpcId: "npc_bob",
        expressionId: "neutral",
        backgroundId: "bg_yard",
        presentationMode: "local",
        text: "Hi.",
      } as const,
    ];
    expect(
      await refusal(planFixture(exportText("first_seq", beats, { npcId: "npc_bob" }))),
    ).toMatch(/NPC identity/);
  });

  it("refuses a beat no source helper can express, rather than inventing an inline beat", async () => {
    const beats = [...FIRST_BEATS];
    beats.push({
      kind: "npc",
      speakerNpcId: "npc_bob",
      expressionId: "neutral",
      backgroundId: "bg_hall",
      presentationMode: "local",
      text: "Bob at the hall.",
    });
    expect(await refusal(planFixture(exportText("first_seq", beats)))).toMatch(
      /No beat helper in the source/,
    );
  });

  it("refuses to add or edit a reward-total beat, and to edit around opaque spread output", async () => {
    const beats = [...FIRST_BEATS];
    beats.push({
      kind: "item",
      itemId: "widget",
      quantity: 3,
      backgroundId: "bg_hall",
      text: "",
      isRewardTotal: true,
    });
    expect(await refusal(planFixture(exportText("first_seq", beats)))).toMatch(/rewardItemBeats/);

    // Editing the plain beat beside a spread is fine; editing the spread's own output is not.
    const around = [ann("neutral", "Before, revised."), spreadSequence().beats[1]!];
    expect(await changedSource(exportText("spread_seq", around))).toContain('"Before, revised."');
    const into = [ann("neutral", "Before."), { ...spreadSequence().beats[1]!, quantity: 4 }];
    expect(await refusal(planFixture(exportText("spread_seq", into)))).toMatch(
      /spread|edit it by hand/,
    );
  });

  it("refuses to remove a beat that carries a source comment", async () => {
    const beats = [FIRST_BEATS[0]!, FIRST_BEATS[2]!, FIRST_BEATS[3]!];
    expect(await refusal(planFixture(exportText("first_seq", beats)))).toMatch(/comment/);
  });

  it("attributes an edit to the beat it resembles, so a removed commented beat is refused", async () => {
    // Removing "Two." (which carries a source comment) while revising "Three."
    // must not rewrite the commented element in place and delete its neighbour.
    const beats = [FIRST_BEATS[0]!, ann("neutral", "Three, revised.", "comms"), FIRST_BEATS[3]!];
    expect(await refusal(planFixture(exportText("first_seq", beats)))).toMatch(/comment/);
  });

  it("keeps the comment on the beat it belongs to when a neighbour is removed and another is edited", async () => {
    const beats = [FIRST_BEATS[0]!, ann("happy", "Two, revised."), FIRST_BEATS[3]!];
    const plan = await planFixture(exportText("first_seq", beats));
    if (plan.status !== "changed") throw new Error("expected a change");
    expect(plan.changes).toEqual([
      expect.stringMatching(/^~ beat 2: text changed/),
      expect.stringMatching(/^- beat 3: removed .*Three/),
    ]);
    expect(plan.newSource).toMatch(
      /\/\/ A note about the middle beat\.\s+annLocal\(EXPRESSION_IDS\.happy, "Two, revised\."\)/,
    );
    expect(plan.newSource).not.toContain('"Three."');
  });

  it("breaks ties between identical helpers by wording, so the commented beat is the one removed", async () => {
    // "Beta." carries the comment. Both later beats share helper and expression,
    // so only the wording says "Gamma, revised." is the edited "Gamma.".
    const beats = [ann("happy", "Alpha."), ann("happy", "Gamma, revised.")];
    expect(await refusal(planFixture(exportText("tie_seq", beats)))).toMatch(/comment/);

    // Removing the uncommented beat and revising the commented one attributes correctly.
    const kept = [ann("happy", "Alpha."), ann("happy", "Beta, revised.")];
    const plan = await planFixture(exportText("tie_seq", kept));
    if (plan.status !== "changed") throw new Error("expected a change");
    expect(plan.changes).toEqual([
      expect.stringMatching(/^~ beat 2: text changed/),
      expect.stringMatching(/^- beat 3: removed .*Gamma/),
    ]);
    expect(plan.newSource).toMatch(
      /\/\/ A note about Beta\.\s+annLocal\(EXPRESSION_IDS\.happy, "Beta, revised\."\)/,
    );
  });

  it("writes a skill XP beat as the source's inline object when no helper fits its background", async () => {
    const beats = [
      ...FIRST_BEATS,
      {
        kind: "skill_xp",
        skillId: "mining",
        amount: 75,
        backgroundId: "bg_yard",
        text: "Level up.",
      } as const,
    ];
    expect(await changedSource(exportText("first_seq", beats))).toMatch(
      /\{\s*kind: "skill_xp",\s*skillId: SKILL_IDS\.mining,\s*amount: 75,\s*backgroundId: yard,\s*text: "Level up\.",?\s*\}/,
    );
  });

  it("refuses when the source array does not line up 1:1 with the resolved beats", async () => {
    const misaligned = fixtureAdapter();
    misaligned.sequences = misaligned.sequences.map((sequence) =>
      sequence.id === "spread_seq"
        ? { ...sequence, beats: [...sequence.beats, ann("happy", "Ghost.")] }
        : sequence,
    );
    const beats = [ann("neutral", "Before, revised."), ...spreadSequence().beats.slice(1)];
    expect(
      await refusal(planFixture(exportText("spread_seq", beats), FIXTURE_SOURCE, misaligned)),
    ).toMatch(/1:1|resolves to|lists 2/);
  });

  it("refuses when the target sequence cannot be located in the source", async () => {
    const noCatalog = FIXTURE_SOURCE.replace("const dialogue = {", "const other = {");
    const beats = [...FIRST_BEATS];
    beats[0] = ann("neutral", "Changed.");
    expect(await refusal(planFixture(exportText("first_seq", beats), noCatalog))).toMatch(
      /Cannot locate the target/,
    );
  });
});

describe("QC Studio apply: orchestration", () => {
  function fakeIo(overrides: Partial<ApplyIo> = {}) {
    const writes: string[] = [];
    const catalog = JSON.stringify(fixtureSequences());
    const io: ApplyIo = {
      readSource: () => FIXTURE_SOURCE,
      writeSource: (text) => void writes.push(text),
      currentCatalog: () => catalog,
      catalogAfterWrite: () =>
        JSON.stringify(
          fixtureSequences().map((sequence) =>
            sequence.id === "first_seq" ? { ...sequence, beats: EDITED_BEATS } : sequence,
          ),
        ),
      ...overrides,
    };
    return { io, writes };
  }
  const EDITED_BEATS = [{ ...FIRST_BEATS[0]!, text: "One, edited." }, ...FIRST_BEATS.slice(1)];
  const options = (mode: "dry-run" | "write", text = exportText("first_seq", EDITED_BEATS)) => ({
    exportText: text,
    mode,
    sourceFileName: FIXTURE_NAME,
    adapter: fixtureAdapter(),
    constants: FIXTURE_CONSTANTS,
    formatSource: formatFixture,
  });

  it("never writes in dry-run", async () => {
    const { io, writes } = fakeIo();
    const report = await applyDialogueExport(options("dry-run"), io);
    expect(report.plan.status).toBe("changed");
    expect(report.written).toBe(false);
    expect(writes).toEqual([]);
  });

  it("writes exactly the planned source once, and only after verification passes", async () => {
    const { io, writes } = fakeIo();
    const report = await applyDialogueExport(options("write"), io);
    expect(report.written).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('"One, edited."');
  });

  it("restores the original file when the fresh-process verification disagrees", async () => {
    const { io, writes } = fakeIo({
      catalogAfterWrite: () => JSON.stringify(fixtureSequences()),
    });
    const message = await refusal(applyDialogueExport(options("write"), io));
    expect(message).toMatch(/Verification failed/);
    expect(message).toMatch(/restored/);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toBe(FIXTURE_SOURCE);
  });

  it("restores the original file when the edited source no longer loads", async () => {
    const { io, writes } = fakeIo({
      catalogAfterWrite: () => {
        throw new Error("SyntaxError: boom");
      },
    });
    expect(await refusal(applyDialogueExport(options("write"), io))).toMatch(/could not be loaded/);
    expect(writes.at(-1)).toBe(FIXTURE_SOURCE);
  });

  it("does not write for a refused export or an already-applied one", async () => {
    const refused = fakeIo();
    await refusal(applyDialogueExport(options("write", "{ nope"), refused.io));
    expect(refused.writes).toEqual([]);

    const noop = fakeIo();
    const report = await applyDialogueExport(
      options("write", exportText("first_seq", FIRST_BEATS)),
      noop.io,
    );
    expect(report.plan.status).toBe("unchanged");
    expect(noop.writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The real catalog and real source
// ---------------------------------------------------------------------------

function realExport(sequenceId: string, mutate: (beats: StudioDialogueBeat[]) => void): string {
  const sequence = runespaceDialogueAdapter.sequences.find((s) => s.id === sequenceId)!;
  const draft = createDraftFromAdapterSequence(runespaceDialogueAdapter, sequence, "real");
  mutate(draft.beats);
  return JSON.stringify(createDialogueExportPayload("runespace", draft));
}

async function planReal(text: string) {
  return planDialogueApply({
    exportText: text,
    sourceText: REAL_SOURCE,
    sourceFileName: DIALOGUE_FILE,
    adapter: runespaceDialogueAdapter,
    constants: RUNESPACE_SOURCE_CONSTANTS,
  });
}

const WADE_FOLLOW_UP = DIALOGUE_IDS.wadeFollowUp;

describe("QC Studio apply against the real dialogue catalog", () => {
  it("resolves a real export to exactly one authoritative sequence and reports no change for every authored sequence", async () => {
    expect(DIALOGUE_SEQUENCES.length).toBeGreaterThan(50);
    for (const sequence of runespaceDialogueAdapter.sequences) {
      const plan = await planReal(realExport(sequence.id, () => {}));
      expect(plan).toMatchObject({ status: "unchanged", sequenceId: sequence.id });
    }
  });

  it("plans a text edit that touches only the targeted entry", async () => {
    const plan = await planReal(
      realExport(WADE_FOLLOW_UP, (beats) => {
        beats[1] = { ...beats[1]!, text: "Good. Now go." } as StudioDialogueBeat;
      }),
    );
    if (plan.status !== "changed") throw new Error("expected a change");

    const before = REAL_SOURCE.split("\n");
    const after = plan.newSource.split("\n");
    expect(after).toHaveLength(before.length);
    const differing = after.flatMap((line, i) => (line === before[i] ? [] : [i]));
    expect(differing).toHaveLength(1);
    expect(after[differing[0]!]).toContain('"Good. Now go."');
    expect(plan.diff).toContain("- ");
    expect(plan.diff).toContain('+       wadeLocal(EXPRESSION_IDS.neutral, "Good. Now go.")');
    expect(plan.beats[1]).toMatchObject({ text: "Good. Now go." });
  });

  it("plans an insertion and a deletion using the native Wade helper", async () => {
    const added = await planReal(
      realExport(WADE_FOLLOW_UP, (beats) => {
        beats.splice(1, 0, { ...beats[0]!, text: "One more thing." } as StudioDialogueBeat);
      }),
    );
    if (added.status !== "changed") throw new Error("expected a change");
    expect(added.newSource).toContain('wadeLocal(EXPRESSION_IDS.concerned, "One more thing.")');
    expect(added.newSource.split("\n").length).toBe(REAL_SOURCE.split("\n").length + 1);

    const removed = await planReal(realExport(WADE_FOLLOW_UP, (beats) => void beats.pop()));
    if (removed.status !== "changed") throw new Error("expected a change");
    expect(removed.newSource.split("\n").length).toBeLessThan(REAL_SOURCE.split("\n").length);
  });

  it("refuses to edit the text of a beat whose copy is computed from game data", async () => {
    const sequence = runespaceDialogueAdapter.sequences.find(
      (s) => s.id === DIALOGUE_IDS.wadeKeepTheChangeOffer,
    )!;
    const index = sequence.beats.findIndex(
      (beat) => beat.kind === "npc" && beat.text.startsWith("Tansy needs three Power Cells"),
    );
    expect(index).toBeGreaterThan(-1);
    const message = await refusal(
      planReal(
        realExport(DIALOGUE_IDS.wadeKeepTheChangeOffer, (beats) => {
          beats[index] = { ...beats[index]!, text: "Tansy needs cells." } as StudioDialogueBeat;
        }),
      ),
    );
    expect(message).toMatch(/computed in source/);
  });

  it("refuses an unknown sequence ID and an old schema against the real catalog", async () => {
    const valid = JSON.parse(realExport(WADE_FOLLOW_UP, () => {})) as {
      source: Record<string, unknown>;
      qcStudio: Record<string, unknown>;
    };
    valid.source.sequenceId = "wade_rusk_not_a_real_sequence";
    await refusal(planReal(JSON.stringify(valid)));
    valid.source.sequenceId = WADE_FOLLOW_UP;
    valid.qcStudio.schemaVersion = 2;
    expect(await refusal(planReal(JSON.stringify(valid)))).toMatch(/schemaVersion 2/);
  });

  it("canonicalizes beats independent of key order", () => {
    expect(canonicalize({ a: 1, b: { d: 1, c: 2 } })).toBe(
      canonicalize({ b: { c: 2, d: 1 }, a: 1 }),
    );
  });
});

describe("pnpm studio:apply command", () => {
  function run(args: string[], stdin?: string) {
    return spawnSync(
      process.execPath,
      ["--experimental-strip-types", path.join(ROOT, "scripts/studio-apply.mjs"), ...args],
      { cwd: ROOT, encoding: "utf8", input: stdin, env: { ...process.env, NODE_NO_WARNINGS: "1" } },
    );
  }

  it("defaults to a dry run: reports the target and diff and leaves dialogue.ts untouched", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "studio-apply-"));
    try {
      const file = path.join(dir, "export.json");
      writeFileSync(
        file,
        realExport(WADE_FOLLOW_UP, (beats) => {
          beats[1] = { ...beats[1]!, text: "Good. Now go." } as StudioDialogueBeat;
        }),
      );
      const result = run([file]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Target: ${WADE_FOLLOW_UP}`);
      expect(result.stdout).toContain('+       wadeLocal(EXPRESSION_IDS.neutral, "Good. Now go.")');
      expect(result.stdout).toContain("Dry run: no file was changed");
      expect(readFileSync(DIALOGUE_FILE, "utf8")).toBe(REAL_SOURCE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("reads the export from stdin and refuses bad input with a non-zero exit and no change", () => {
    const result = run(["-", "--write"], "{ not json");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refused; no file was changed.");
    expect(readFileSync(DIALOGUE_FILE, "utf8")).toBe(REAL_SOURCE);
  }, 60_000);

  it("rejects unknown options", () => {
    const result = run(["--wrtie", "export.json"]);
    expect(result.status).toBe(64);
    expect(readFileSync(DIALOGUE_FILE, "utf8")).toBe(REAL_SOURCE);
  }, 60_000);
});
