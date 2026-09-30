import { format as prettierFormat, resolveConfig } from "prettier";
import ts from "typescript";
import { z } from "zod";
import {
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import type { DialogueExportPayload } from "../../core/export";
import {
  QC_STUDIO_SCHEMA_VERSION,
  STUDIO_DIALOGUE_ACTIONS,
  STUDIO_PRESENTATION_MODES,
  type DialogueAdapter,
  type DialogueDraft,
  type StudioDialogueBeat,
} from "../../core/types";
import { validateDialogueDraft } from "../../core/validation";
import {
  evaluateHelperCall,
  indexDialogueSource,
  locateSequence,
  resolveStatic,
  type BeatHelper,
  type BeatValue,
  type ConstantMaps,
  type DialogueSourceIndex,
  type SourceElement,
} from "./dialogue-source";

/**
 * Deterministic apply of a reviewed QC Studio dialogue export (#185).
 *
 * Contract: fail closed. Anything not positively understood — an unsupported
 * schema, an unknown or ambiguous target, a beat the source expresses in a way
 * this tool cannot edit exactly — is a refusal that changes no file. The tool
 * never infers gameplay from prose and never edits outside the one targeted
 * `[DIALOGUE_IDS.*]` entry. See "Applying QC Studio exports" in
 * `docs/qc-studio.md`.
 */

export class ApplyRefusal extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(reasons.join("\n"));
    this.name = "ApplyRefusal";
    this.reasons = reasons;
  }
}

// ---------------------------------------------------------------------------
// Export parsing
// ---------------------------------------------------------------------------

const npcBeatSchema = z
  .object({
    kind: z.literal("npc"),
    speakerNpcId: z.string(),
    expressionId: z.string(),
    backgroundId: z.string(),
    presentationMode: z.enum(STUDIO_PRESENTATION_MODES),
    text: z.string(),
  })
  .strict();

const itemBeatSchema = z
  .object({
    kind: z.literal("item"),
    itemId: z.string(),
    quantity: z.number(),
    backgroundId: z.string(),
    text: z.string(),
    isRewardTotal: z.literal(true).optional(),
  })
  .strict();

const skillXpBeatSchema = z
  .object({
    kind: z.literal("skill_xp"),
    skillId: z.string(),
    amount: z.number(),
    backgroundId: z.string(),
    text: z.string(),
  })
  .strict();

const exportSchema = z
  .object({
    qcStudio: z
      .object({
        schemaVersion: z.literal(QC_STUDIO_SCHEMA_VERSION),
        module: z.literal("dialogue"),
        adapterId: z.string(),
      })
      .strict(),
    source: z
      .object({
        kind: z.enum(["authoritative_sequence", "new_draft"]),
        sequenceId: z.string().min(1).optional(),
        proposedStableId: z.string().optional(),
      })
      .strict(),
    sequence: z
      .object({
        title: z.string(),
        npcId: z.string(),
        beats: z.array(
          z.discriminatedUnion("kind", [npcBeatSchema, itemBeatSchema, skillXpBeatSchema]),
        ),
        action: z.enum(STUDIO_DIALOGUE_ACTIONS).optional(),
      })
      .strict(),
  })
  .strict();

// The schema and the Studio's own export/beat types must describe the same
// shape in both directions; a change to either side fails to compile here
// instead of silently drifting.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const exportShapeInSync: Equal<DialogueExportPayload, z.infer<typeof exportSchema>> = true;
void exportShapeInSync;

export type ParsedDialogueExport = {
  sequenceId: string;
  npcId: string;
  beats: StudioDialogueBeat[];
  /** Export fields that are accepted but deliberately never written to source. */
  ignored: string[];
};

export function parseDialogueExport(
  exportText: string,
  adapter: DialogueAdapter,
): ParsedDialogueExport {
  let raw: unknown;
  try {
    raw = JSON.parse(exportText);
  } catch (error) {
    throw new ApplyRefusal([
      `The export is not valid JSON (${error instanceof Error ? error.message : "parse error"}).`,
    ]);
  }

  // Name the version problem plainly before strict parsing, so a future export
  // with new fields reports "unsupported version", not a wall of unknown keys.
  const declaredVersion = (raw as { qcStudio?: { schemaVersion?: unknown } } | null)?.qcStudio
    ?.schemaVersion;
  if (declaredVersion !== QC_STUDIO_SCHEMA_VERSION) {
    throw new ApplyRefusal([
      `Unsupported export schemaVersion ${JSON.stringify(declaredVersion)}; this tool applies exactly schemaVersion ${QC_STUDIO_SCHEMA_VERSION}. Re-copy the export from a current QC Studio.`,
    ]);
  }

  const parsed = exportSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApplyRefusal(
      parsed.error.issues.map(
        (issue) => `Malformed export at ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }
  const data = parsed.data;

  if (data.qcStudio.adapterId !== adapter.adapterId) {
    throw new ApplyRefusal([
      `Export adapterId "${data.qcStudio.adapterId}" is not "${adapter.adapterId}"; refusing to guess what it targets.`,
    ]);
  }
  if (data.source.kind === "new_draft") {
    throw new ApplyRefusal([
      'source.kind "new_draft" is not applied mechanically: registering a new dialogue needs a stable ID and content-organization decision. Apply it by hand per docs/qc-studio.md.',
    ]);
  }
  const sequenceId = data.source.sequenceId;
  if (!sequenceId) {
    throw new ApplyRefusal(['source.kind "authoritative_sequence" requires source.sequenceId.']);
  }
  if (data.source.proposedStableId !== undefined) {
    throw new ApplyRefusal(["An authoritative_sequence export must not carry proposedStableId."]);
  }

  const { beats } = data.sequence;
  const draft: DialogueDraft = {
    schemaVersion: QC_STUDIO_SCHEMA_VERSION,
    adapterId: adapter.adapterId,
    draftId: "studio-apply",
    title: data.sequence.title,
    sourceSequenceId: sequenceId,
    npcId: data.sequence.npcId,
    beats,
    ...(data.sequence.action ? { action: data.sequence.action } : {}),
  };
  const validation = validateDialogueDraft(adapter, draft);
  if (!validation.valid) {
    throw new ApplyRefusal(
      validation.issues.map((issue) => `Invalid export content at ${issue.path}: ${issue.message}`),
    );
  }

  const ignored = ["sequence.title (Studio metadata; RuneSpace sequences have no title)"];
  if (data.sequence.action) {
    ignored.push(
      `sequence.action "${data.sequence.action}" (dialogue sequences are presentation only; Mission actions live on Mission conversation content)`,
    );
  }
  return { sequenceId, npcId: data.sequence.npcId, beats, ignored };
}

// ---------------------------------------------------------------------------
// Beat comparison and diff
// ---------------------------------------------------------------------------

type BeatRecord = Record<string, BeatValue | boolean | undefined>;

export function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(
        Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return inner;
  });
}

type DiffOp =
  | { type: "keep"; i: number; j: number }
  | { type: "remove"; i: number }
  | { type: "add"; j: number };

/** Longest-common-subsequence diff; inputs here are one dialogue sequence or its source lines. */
function diffOps<T>(a: readonly T[], b: readonly T[], equal: (x: T, y: T) => boolean): DiffOp[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = equal(a[i]!, b[j]!)
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (equal(a[i]!, b[j]!)) {
      ops.push({ type: "keep", i: i++, j: j++ });
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ type: "remove", i: i++ });
    } else {
      ops.push({ type: "add", j: j++ });
    }
  }
  while (i < a.length) ops.push({ type: "remove", i: i++ });
  while (j < b.length) ops.push({ type: "add", j: j++ });
  return ops;
}

function renderLineDiff(before: string, after: string, context = 2): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const ops = diffOps(a, b, (x, y) => x === y);
  const lines = ops.map((op) =>
    op.type === "keep" ? `  ${a[op.i]}` : op.type === "remove" ? `- ${a[op.i]}` : `+ ${b[op.j]}`,
  );
  const changed = lines.map((line) => !line.startsWith("  "));
  const near = (index: number) =>
    changed.slice(Math.max(0, index - context), index + context + 1).some(Boolean);
  // Show only lines within `context` of a change, marking each skipped run.
  const out: string[] = [];
  let previous = -1;
  lines.forEach((line, index) => {
    if (!near(index)) return;
    if (previous !== -1 && index !== previous + 1) out.push("  ...");
    out.push(line);
    previous = index;
  });
  return out.join("\n");
}

type HunkStep =
  | { type: "pair"; r: number; a: number }
  | { type: "remove"; r: number }
  | { type: "add"; a: number };

/** How alike two beats are: 0 when they are different kinds or share no field. */
function similarity(a: BeatRecord, b: BeatRecord): number {
  if (a.kind !== b.kind) return 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("kind");
  return [...keys].filter((key) => a[key] === b[key]).length;
}

/**
 * Orders one run of removed and added beats as pair / remove / add steps,
 * pairing in order (never crossing) so the total similarity is highest.
 */
function alignHunk(
  removes: readonly number[],
  adds: readonly number[],
  oldBeats: readonly BeatRecord[],
  newBeats: readonly BeatRecord[],
): HunkStep[] {
  const rows = removes.length;
  const cols = adds.length;
  const sim = (i: number, j: number) => similarity(oldBeats[removes[i]!]!, newBeats[adds[j]!]!);
  const best: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  );
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      const paired = sim(i, j);
      best[i]![j] = Math.max(
        best[i + 1]![j]!,
        best[i]![j + 1]!,
        paired > 0 ? best[i + 1]![j + 1]! + paired : 0,
      );
    }
  }
  const steps: HunkStep[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    const paired = sim(i, j);
    if (paired > 0 && best[i]![j] === best[i + 1]![j + 1]! + paired) {
      steps.push({ type: "pair", r: removes[i++]!, a: adds[j++]! });
    } else if (best[i]![j] === best[i + 1]![j]) {
      steps.push({ type: "remove", r: removes[i++]! });
    } else {
      steps.push({ type: "add", a: adds[j++]! });
    }
  }
  while (i < rows) steps.push({ type: "remove", r: removes[i++]! });
  while (j < cols) steps.push({ type: "add", a: adds[j++]! });
  return steps;
}

function describeBeat(beat: BeatRecord): string {
  const subject =
    beat.kind === "npc"
      ? `${String(beat.speakerNpcId)}/${String(beat.expressionId)}`
      : beat.kind === "item"
        ? `${String(beat.itemId)} ×${String(beat.quantity)}`
        : `${String(beat.skillId)} +${String(beat.amount)} XP`;
  const text = typeof beat.text === "string" ? beat.text : "";
  return `${beat.kind} ${subject}${text ? ` "${text.length > 48 ? `${text.slice(0, 45)}...` : text}"` : ""}`;
}

function changedFields(before: BeatRecord, after: BeatRecord): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]);
}

// ---------------------------------------------------------------------------
// Source emission
// ---------------------------------------------------------------------------

/** The authoritative registries `game/content/dialogue.ts` refers to by name. */
export const RUNESPACE_SOURCE_CONSTANTS = {
  NPC_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  SKILL_IDS,
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
} as const satisfies ConstantMaps;

/** Which authoritative registry a beat field's identifier belongs to. */
const FIELD_REGISTRY: Readonly<Record<string, keyof typeof RUNESPACE_SOURCE_CONSTANTS>> = {
  speakerNpcId: "NPC_IDS",
  expressionId: "EXPRESSION_IDS",
  itemId: "ITEM_IDS",
  skillId: "SKILL_IDS",
  backgroundId: "CONVERSATION_BACKGROUND_IDS",
};

type Context = { index: DialogueSourceIndex };

function refuse(message: string): never {
  throw new ApplyRefusal([message]);
}

function renderValue(field: string, value: BeatValue | boolean | undefined, ctx: Context): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return refuse(`Cannot render \`${field}\` into source.`);
  const registry = FIELD_REGISTRY[field];
  if (!registry) return JSON.stringify(value);
  if (field === "backgroundId") {
    for (const [name, aliased] of ctx.index.aliases) if (aliased === value) return name;
  }
  const map = ctx.index.constants[registry] ?? {};
  const key = Object.keys(map).find((candidate) => map[candidate] === value);
  if (!key) return refuse(`\`${field}\` "${value}" is not in the authoritative ${registry}.`);
  return `${registry}.${key}`;
}

/** True when `helper` produces exactly `beat`, optionally leaving one fixed field to the caller. */
function helperFits(helper: BeatHelper, beat: BeatRecord, ignoreFixed?: string): boolean {
  if (helper.kind !== beat.kind) return false;
  const paramFields = new Set(helper.params.map((param) => param.field));
  for (const [field, value] of Object.entries(helper.fixed)) {
    if (field !== ignoreFixed && beat[field] !== value) return false;
  }
  for (const [field, value] of Object.entries(beat)) {
    if (field === "kind" || value === undefined) continue;
    if (!paramFields.has(field) && !(field in helper.fixed)) return false;
  }
  return helper.params.every(
    (param) => beat[param.field] !== undefined || param.defaultValue !== undefined,
  );
}

function helperCallText(helper: BeatHelper, beat: BeatRecord, ctx: Context): string {
  let end = helper.params.length;
  while (end > 0) {
    const param = helper.params[end - 1]!;
    if (param.defaultValue === undefined || beat[param.field] !== param.defaultValue) break;
    end--;
  }
  const args = helper.params
    .slice(0, end)
    .map((param) => renderValue(param.field, beat[param.field], ctx));
  return `${helper.name}(${args.join(", ")})`;
}

function emitBeat(beat: BeatRecord, ctx: Context, preferred?: BeatHelper): string {
  if (beat.isRewardTotal) {
    return refuse(
      "A reward-total item beat is generated by `rewardItemBeats`; it cannot be added or changed mechanically. Edit it by hand.",
    );
  }
  const fits = ctx.index.helpers.filter((helper) => helperFits(helper, beat));
  if (fits.length > 1 && !(preferred && fits.includes(preferred))) {
    return refuse(
      `Ambiguous beat helpers (${fits.map((helper) => helper.name).join(", ")}) all produce ${describeBeat(beat)}; edit it by hand.`,
    );
  }
  const helper =
    fits.length === 1 ? fits[0] : preferred && fits.includes(preferred) ? preferred : undefined;
  if (helper) return helperCallText(helper, beat, ctx);

  if (beat.kind === "item") {
    // `{ ...itemBeat(...), backgroundId: x }` is the source's own pattern for an
    // item beat presented against a background other than the helper's.
    const overridable = ctx.index.helpers.find(
      (candidate) =>
        candidate.kind === "item" &&
        Object.keys(candidate.fixed).every((field) => field === "backgroundId") &&
        helperFits(candidate, beat, "backgroundId"),
    );
    if (overridable) {
      return `{ ...${helperCallText(overridable, { ...beat, backgroundId: overridable.fixed.backgroundId }, ctx)}, backgroundId: ${renderValue("backgroundId", beat.backgroundId, ctx)} }`;
    }
  }
  if (beat.kind === "skill_xp") {
    return `{ kind: "skill_xp", skillId: ${renderValue("skillId", beat.skillId, ctx)}, amount: ${renderValue("amount", beat.amount, ctx)}, backgroundId: ${renderValue("backgroundId", beat.backgroundId, ctx)}, text: ${renderValue("text", beat.text, ctx)} }`;
  }
  return refuse(
    `No beat helper in the source produces ${describeBeat(beat)} (background ${String(beat.backgroundId)}). Add a helper or edit it by hand; the tool will not invent an inline beat.`,
  );
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

type Edit = { start: number; end: number; text: string; order: number };

export type ApplyPlan =
  | { status: "unchanged"; sequenceId: string; ignored: string[] }
  | {
      status: "changed";
      sequenceId: string;
      newSource: string;
      /** The exported beats the write must make the authoritative sequence resolve to. */
      beats: StudioDialogueBeat[];
      changes: string[];
      diff: string;
      ignored: string[];
    };

export type PlanInput = {
  exportText: string;
  sourceText: string;
  sourceFileName: string;
  adapter: DialogueAdapter;
  /** Registries the source names: NPC_IDS, EXPRESSION_IDS, ITEM_IDS, SKILL_IDS, CONVERSATION_BACKGROUND_IDS, DIALOGUE_IDS. */
  constants: ConstantMaps;
  /** Formats the edited file; defaults to the repository's Prettier config. */
  formatSource?: (text: string, fileName: string) => Promise<string>;
};

async function formatWithPrettier(text: string, fileName: string): Promise<string> {
  const config = (await resolveConfig(fileName)) ?? {};
  return prettierFormat(text, { ...config, filepath: fileName });
}

function isStaticArgument(argument: ts.Expression, index: DialogueSourceIndex): boolean {
  return resolveStatic(argument, index.constants, index.aliases) !== undefined;
}

function replaceElement(
  element: SourceElement,
  oldBeat: BeatRecord,
  newBeat: BeatRecord,
  position: number,
  ctx: Context,
): Omit<Edit, "order">[] {
  if (element.kind === "opaque") {
    return refuse(
      `Beat ${position} is ${element.reason} in the source; the tool cannot edit it exactly. Edit it by hand.`,
    );
  }
  const { helper, call } = element;
  const sourceFile = ctx.index.sourceFile;

  if (helperFits(helper, newBeat)) {
    const edits: Omit<Edit, "order">[] = [];
    for (const [i, param] of helper.params.entries()) {
      const argument = call.arguments[i];
      if (!argument || newBeat[param.field] === oldBeat[param.field]) continue;
      if (!isStaticArgument(argument, ctx.index)) {
        return refuse(
          `Beat ${position}: \`${param.field}\` is computed in source (\`${argument.getText(sourceFile)}\`), so its exported text cannot be written back. Edit it by hand.`,
        );
      }
      edits.push({
        start: argument.getStart(sourceFile),
        end: argument.end,
        text: renderValue(param.field, newBeat[param.field], ctx),
      });
    }
    // Trailing defaulted arguments the source omitted (e.g. an item caption).
    const missing = helper.params.slice(call.arguments.length);
    let last = -1;
    missing.forEach((param, i) => {
      if (newBeat[param.field] !== param.defaultValue) last = i;
    });
    const lastArgument = call.arguments[call.arguments.length - 1];
    if (last >= 0 && !lastArgument) {
      return refuse(
        `Beat ${position} calls \`${helper.name}\` with no arguments and cannot be extended exactly. Edit it by hand.`,
      );
    }
    if (last >= 0 && lastArgument) {
      edits.push({
        start: lastArgument.end,
        end: lastArgument.end,
        text: missing
          .slice(0, last + 1)
          .map((param) => `, ${renderValue(param.field, newBeat[param.field], ctx)}`)
          .join(""),
      });
    }
    return edits;
  }

  // The beat no longer fits its helper (speaker/background changed): rebuild it,
  // but only when nothing computed in the old call would be frozen into a literal.
  if (!element.isStatic) {
    return refuse(
      `Beat ${position} calls \`${helper.name}\` with computed arguments and no longer fits that helper; edit it by hand.`,
    );
  }
  return [
    {
      start: element.node.getStart(sourceFile),
      end: element.node.end,
      text: emitBeat(newBeat, ctx, helper),
    },
  ];
}

function deleteElement(
  element: SourceElement,
  position: number,
  ctx: Context,
): Omit<Edit, "order"> {
  if (element.kind === "opaque") {
    return refuse(
      `Beat ${position} is ${element.reason} in the source; the tool cannot remove it exactly. Edit it by hand.`,
    );
  }
  const text = ctx.index.sourceText;
  if ((ts.getLeadingCommentRanges(text, element.node.pos) ?? []).length > 0) {
    return refuse(
      `Beat ${position} has a source comment attached to it; removing it would orphan the comment. Edit it by hand.`,
    );
  }
  const comma = /^\s*,/.exec(text.slice(element.node.end));
  const end = element.node.end + (comma ? comma[0].length : 0);
  if ((ts.getTrailingCommentRanges(text, end) ?? []).length > 0) {
    return refuse(`Beat ${position} has a trailing source comment; edit it by hand.`);
  }
  return { start: element.node.pos, end, text: "" };
}

export async function planDialogueApply(input: PlanInput): Promise<ApplyPlan> {
  const { adapter } = input;
  const exported = parseDialogueExport(input.exportText, adapter);

  const current = adapter.sequences.find((sequence) => sequence.id === exported.sequenceId);
  if (!current) {
    throw new ApplyRefusal([
      `Unknown sequenceId "${exported.sequenceId}": no authoritative dialogue has that stable ID. Nothing was created.`,
    ]);
  }
  if (current.npcId !== exported.npcId) {
    throw new ApplyRefusal([
      `Export sequence.npcId "${exported.npcId}" differs from the authoritative "${current.npcId}". Changing a sequence's NPC identity is not a dialogue-text edit; refusing.`,
    ]);
  }

  const oldBeats = current.beats.map((beat) => ({ ...beat }) as BeatRecord);
  const newBeats = exported.beats.map((beat) => ({ ...beat }) as BeatRecord);
  const same = (x: BeatRecord, y: BeatRecord) => canonicalize(x) === canonicalize(y);

  if (
    oldBeats.length === newBeats.length &&
    oldBeats.every((beat, i) => same(beat, newBeats[i]!))
  ) {
    return { status: "unchanged", sequenceId: exported.sequenceId, ignored: exported.ignored };
  }

  const index = indexDialogueSource(input.sourceText, input.sourceFileName, input.constants);
  const ctx: Context = { index };
  const location = locateSequence(index, exported.sequenceId);
  if (typeof location === "string")
    throw new ApplyRefusal([`Cannot locate the target: ${location}.`]);
  const { elements } = location;

  // The source array must line up 1:1 with the beats the sequence resolves to.
  // Helper calls with fully static arguments are re-evaluated as a cross-check.
  if (elements.length !== oldBeats.length) {
    throw new ApplyRefusal([
      `The source lists ${elements.length} beat expression(s) but the sequence resolves to ${oldBeats.length} beat(s) (a spread or computed group); the tool cannot map edits exactly. Edit it by hand.`,
    ]);
  }
  elements.forEach((element, i) => {
    if (element.kind !== "helper-call" || !element.isStatic) return;
    const evaluated = evaluateHelperCall(element, index);
    if (!evaluated || !same(evaluated as BeatRecord, oldBeats[i]!)) {
      throw new ApplyRefusal([
        `Source beat ${i + 1} does not evaluate to the authoritative beat; refusing to edit a sequence the tool cannot map exactly.`,
      ]);
    }
  });

  const edits: Edit[] = [];
  const changes: string[] = [];
  const push = (list: Omit<Edit, "order">[]) => {
    for (const edit of list) edits.push({ ...edit, order: edits.length });
  };

  const ops = diffOps(oldBeats, newBeats, same);
  let cursor = 0;
  let lastKept = -1;
  while (cursor < ops.length) {
    const op = ops[cursor]!;
    if (op.type === "keep") {
      lastKept = op.i;
      cursor++;
      continue;
    }
    const removes: number[] = [];
    const adds: number[] = [];
    while (cursor < ops.length && ops[cursor]!.type !== "keep") {
      const inner = ops[cursor++]!;
      if (inner.type === "remove") removes.push(inner.i);
      else if (inner.type === "add") adds.push(inner.j);
    }
    const nextKept = cursor < ops.length ? (ops[cursor] as { i: number }).i : -1;

    // Pair each new beat with the removed beat it most resembles; never by bare
    // position, which would attribute an edit (and any source comment) to the
    // wrong element when the run has unequal numbers of removals and additions.
    const steps = alignHunk(removes, adds, oldBeats, newBeats);
    const firstPaired = steps.find((step) => step.type === "pair");
    const followingSurvivor = firstPaired?.type === "pair" ? firstPaired.r : nextKept;
    let survivor = lastKept;
    for (const step of steps) {
      if (step.type === "pair") {
        push(
          replaceElement(elements[step.r]!, oldBeats[step.r]!, newBeats[step.a]!, step.r + 1, ctx),
        );
        changes.push(
          `~ beat ${step.r + 1}: ${changedFields(oldBeats[step.r]!, newBeats[step.a]!).join(", ")} changed → ${describeBeat(newBeats[step.a]!)}`,
        );
        survivor = step.r;
      } else if (step.type === "remove") {
        push([deleteElement(elements[step.r]!, step.r + 1, ctx)]);
        changes.push(`- beat ${step.r + 1}: removed ${describeBeat(oldBeats[step.r]!)}`);
      } else {
        const snippet = emitBeat(newBeats[step.a]!, ctx);
        changes.push(`+ beat ${step.a + 1}: added ${describeBeat(newBeats[step.a]!)}`);
        if (survivor >= 0) {
          const after = elements[survivor]!.node.end;
          push([{ start: after, end: after, text: `, ${snippet}` }]);
        } else if (followingSurvivor >= 0) {
          const before = elements[followingSurvivor]!.node.pos;
          push([{ start: before, end: before, text: `${snippet}, ` }]);
        } else {
          throw new ApplyRefusal(["The source sequence has no beat to anchor an insertion to."]);
        }
      }
    }
  }

  const ordered = [...edits].sort((a, b) => b.start - a.start || b.order - a.order);
  ordered.forEach((edit, i) => {
    const later = ordered[i - 1];
    if (later && edit.end > later.start) {
      throw new ApplyRefusal(["Internal error: overlapping source edits; nothing was changed."]);
    }
  });
  let edited = input.sourceText;
  for (const edit of ordered) {
    edited = edited.slice(0, edit.start) + edit.text + edited.slice(edit.end);
  }

  let formatted: string;
  try {
    formatted = await (input.formatSource ?? formatWithPrettier)(edited, input.sourceFileName);
  } catch (error) {
    throw new ApplyRefusal([
      `The edited source did not parse or format (${error instanceof Error ? error.message.split("\n")[0] : "error"}); nothing was changed.`,
    ]);
  }

  // Modify only the targeted entry: everything before and after it must be
  // byte-identical to the original after formatting.
  const start = location.property.getStart(index.sourceFile);
  const end = location.property.end;
  const prefix = input.sourceText.slice(0, start);
  const suffix = input.sourceText.slice(end);
  if (!formatted.startsWith(prefix) || !formatted.endsWith(suffix)) {
    throw new ApplyRefusal([
      "Formatting the edited file would change text outside the targeted sequence (is dialogue.ts Prettier-clean?); nothing was changed.",
    ]);
  }
  const diff = renderLineDiff(
    input.sourceText.slice(start, end),
    formatted.slice(start, formatted.length - suffix.length),
  );

  return {
    status: "changed",
    sequenceId: exported.sequenceId,
    newSource: formatted,
    beats: exported.beats,
    changes,
    diff,
    ignored: exported.ignored,
  };
}

// ---------------------------------------------------------------------------
// Orchestration: dry-run by default, verified write
// ---------------------------------------------------------------------------

export type ApplyMode = "dry-run" | "write";

export type ApplyIo = {
  readSource(): string;
  writeSource(text: string): void;
  /** JSON of the authoritative dialogue catalog as currently loaded. */
  currentCatalog(): string;
  /** JSON of the catalog as a fresh process resolves it after the write. */
  catalogAfterWrite(): string;
};

export type ApplyReport = { plan: ApplyPlan; mode: ApplyMode; written: boolean };

type CatalogSequence = { id: string; beats: unknown };

/**
 * Plans the change, and in `write` mode applies it and then proves it: a fresh
 * process must load the edited source, resolve the target to exactly the exported
 * beats, and leave every other sequence unchanged. Any failure restores the
 * original file.
 */
export async function applyDialogueExport(
  options: Omit<PlanInput, "sourceText"> & { mode: ApplyMode },
  io: ApplyIo,
): Promise<ApplyReport> {
  const original = io.readSource();
  const plan = await planDialogueApply({ ...options, sourceText: original });
  if (plan.status === "unchanged" || options.mode === "dry-run") {
    return { plan, mode: options.mode, written: false };
  }

  const before = JSON.parse(io.currentCatalog()) as CatalogSequence[];
  const expected = before.map((sequence) =>
    sequence.id === plan.sequenceId ? { ...sequence, beats: plan.beats } : sequence,
  );
  io.writeSource(plan.newSource);
  try {
    const after = JSON.parse(io.catalogAfterWrite()) as CatalogSequence[];
    if (canonicalize(after) !== canonicalize(expected)) {
      throw new ApplyRefusal([
        "Verification failed: the edited source does not resolve to exactly the exported beats with every other sequence unchanged.",
      ]);
    }
  } catch (error) {
    io.writeSource(original);
    if (error instanceof ApplyRefusal) {
      throw new ApplyRefusal([...error.reasons, "The original file was restored."]);
    }
    throw new ApplyRefusal([
      `Verification failed: the edited source could not be loaded (${error instanceof Error ? error.message.split("\n")[0] : "error"}). The original file was restored.`,
    ]);
  }
  return { plan, mode: options.mode, written: true };
}
