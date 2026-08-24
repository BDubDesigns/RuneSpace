# Issue #108 — Item-acquired presentation beats in dialogue + QC Studio

Branch: `feat/issue-108-item-beats` (fresh from `origin/main` post-#107)
Issue: https://github.com/BDubDesigns/RuneSpace/issues/108

## What ships

1. **Typed beat union** — a dialogue beat's visual subject is an NPC **or** an
   item, never both, never neither.
2. **Shared item scene rendering** in `DialogueScene` — production game and QC
   Studio preview render the identical implementation (existing invariant).
3. **Cutter reveal** as the first beat of `tansyAfterClaim` (post-success route
   only; capacity refusals never show it — that routing is already safe and we
   don't touch it).
4. **QC Studio authoring** — subject toggle, authoritative item dropdown from
   the RuneSpace adapter, quantity constrained by real stack limits.
5. **Schema v2** for Studio drafts/exports with explicit v1→v2 migration.
6. **Production availability of `/qc-studio`** behind the existing explicit
   `QC_STUDIO_ENABLED=true` flag, plus `noindex,nofollow`.

Presentation-only: no inventory mutation anywhere near this code path.

## Design decisions (evidence-based)

### Beat type shape

```ts
export type DialogueBeat =
  | {
      kind: "npc";
      speakerNpcId: NpcId;
      expressionId: ExpressionId;
      backgroundId: ConversationBackgroundId;
      presentationMode: DialoguePresentationMode;
      text: string;
    }
  | {
      kind: "item";
      itemId: ItemId;
      quantity: number; // 1..stackLimit for stacks; 1 for unique
      backgroundId: ConversationBackgroundId;
      text: string; // optional caption; empty string allowed
    };
```

- Discriminated on a new required `kind` field → invalid mixed states are
  unrepresentable (issue requirement).
- Existing authored NPC beats stay readable: keep the four helper functions,
  add `kind: "npc"` to each; add an `itemBeat(...)` helper for the Cutter beat.
  One-time mechanical edit across all ~50 authored beats via sed-like patching.
- `resolveDialogueSpeaker(beat)` becomes NPC-beat-only (returns undefined for
  item beats); new `resolveDialogueItem(beat)` resolves item presentation +
  definition. Call sites updated.

### Quantity source of truth

`getItemDefinition(itemId)` from `game/config/balance.ts` is the ONLY stack-limit
source. New pure helpers in `game/content/item-presentation.ts`:

- `getItemBeatQuantityRange(itemId)` → `{ min: 1, max: stackLimit }` for stacks,
  `{min:1, max:1}` for unique, `undefined` for unknown items.

No duplicated limits anywhere in Studio or renderer.

### Scene rendering (DialogueScene)

For item beats:
- background image stays; NO portrait `<Image>` rendered;
- item artwork centered (`h-[72%] w-auto`, object-contain, no stretch), reuse
  the existing fade-in animation class (`data-portrait-transition="fade-in"`,
  already reduced-motion-disabled in globals.css);
- location plate + comms semantics untouched; comms scanline overlay renders
  but no fake item-as-comms portrait exists under it (no nonsense);
- panel eyebrow switches from NPC name/role to `ITEM ACQUIRED` / `Item acquired`
  style treatment: eyebrow = "ITEM ACQUIRED", name line = displayName (+ ` ×N`
  when N>1), role line = accessible description;
- alt text = authoritative `accessibleDescription`; screen readers get identity
  + quantity via the name line text; not announced as a speaker;
- `data-dialogue-subject="npc|item"` attribute for tests/E2E;
- unknown itemId or missing artwork → fail safe: textFallback initials block,
  never a crash.

### Walk It Off wiring

`tansyAfterClaim.beats[0]` becomes `itemBeat(salvageCutter, jag)`. Routing in
`NpcInteractionPanel` already swaps to this sequence only after
`result.mission.status === "completed"` — zero changes needed there. Capacity
refusals route to `tansyCapacitySlots/Mass`, which contain no item beats.
The two Tansy NPC beats follow unchanged.

### QC Studio schema v2

- `QC_STUDIO_SCHEMA_VERSION = 2`.
- `StudioDialogueBeat` mirrors the production union (string IDs).
- Storage key bumps `qc-studio:<adapter>:dialogue:v1` → `...v2`. On load:
  - v2 envelope → parse as-is;
  - v1 envelope found under old key OR v1-shaped payload → migrate every beat
    `{...rest, kind: "npc"}`, bump schemaVersion, keep checkpoints;
  - future version → existing "left untouched" unsupported behavior.
  This satisfies "v1 drafts must not be silently destroyed".
- Export payload carries `schemaVersion: 2`; beats include `itemId`/`quantity`
  deterministically. Docs updated: export contract states presentation-only.

### Studio UI (DialogueStudio)

- Subject radio group per beat: **NPC** / **Item** (structural change → history
  snapshot).
- Item beats: speaker/expression/presentation-mode controls hidden; item select
  (from `adapter.items`) + number input clamped to the definition-derived range;
  switching items re-clamps quantity (reset to 1 when previous value exceeds
  new max).
- Beat list label for item beats: `${displayName}${quantity > 1 ? ` ×${quantity}` : ""}`
  instead of "Unknown speaker".
- Validation additions: known itemId in adapter catalog; integer quantity within
  authoritative range; no invalid mixed fields (type makes most impossible);
  caption optional for item beats (empty text valid).
- Preview typewriter: item beats reveal instantly (no text to type when empty).

### Adapter

RuneSpace adapter gains `items: readonly StudioItem[]` mapped from
`DIALOGUE_ITEM_CATALOG` (new: intersection of `itemPresentations` keys with
`getItemDefinition`) carrying `{id, displayName, kind, stackLimit?}`.
Generic core stays game-agnostic.

### Route availability

```ts
// app/qc-studio/page.tsx
export const metadata = { robots: { index: false, follow: false }, ... };
if (process.env.QC_STUDIO_ENABLED !== "true") notFound();
```

NODE_ENV prohibition removed entirely. Coolify previews inherit app env vars by
default → likely zero config change; if prod lacks the flag it just 404s until
Brandon sets it. PR documents this explicitly.

## Files touched

| File | Change |
|---|---|
| `game/config/foundations.ts` | none expected |
| `game/content/dialogue.ts` | union type, `kind` on all authored beats, `resolveDialogueItem` |
| `game/content/item-presentation.ts` | `getItemBeatQuantityRange`, `DIALOGUE_ITEM_CATALOG` |
| `features/dialogue/DialogueScene.tsx` | item rendering branch |
| `features/dialogue/DialoguePlayer.tsx` | drawer title fallback for item beats |
| `tools/qc-studio/core/types.ts` | v2 union, adapter `items`, version const |
| `tools/qc-studio/core/storage.ts` | v2 key, migration, validators |
| `tools/qc-studio/core/draft.ts` | blank/dup draft defaults carry `kind` |
| `tools/qc-studio/core/export.ts` | unchanged shape (beats flow through) |
| `tools/qc-studio/core/validation.ts` | per-kind rules |
| `tools/qc-studio/adapters/runespace/dialogue-adapter.ts` | items catalog mapping |
| `tools/qc-studio/modules/dialogue/DialogueStudio.tsx` | subject controls, clamp logic, labels |
| `app/qc-studio/page.tsx` | flag-only gate + noindex metadata |
| `docs/qc-studio.md` | v2 contract, deployed review path, presentation-only clause |
| tests (unit) | `tests/unit/qc-studio*.test.ts`, new `dialogue-item-beats.test.ts` |
| tests (e2e) | `walk-it-off.spec.ts` Cutter-reveal asserts, `qc-studio.spec.ts` item authoring |

Non-goals honored: no grant_item effect, no cutscene engine, no auth system, no
schema/db changes, no mission/reward logic edits.

## Ordered implementation steps

1. Content model: union + authored-beat migration + resolvers (unit tests first
   where cheap: resolver + range helper).
2. Scene + player rendering (production surface), with `data-dialogue-subject`.
3. Walk It Off Cutter beat content edit.
4. Studio core types/storage/draft/validation + migration tests.
5. Adapter items catalog.
6. Studio UI controls + preview labels.
7. Route gate flip + metadata.
8. Docs update.
9. Full local CI-parity validation (Hermes disposable-DB path), E2E updates run
   via canonical runner phases, then push draft PR.

## Test plan (lean, risk-targeted)

Unit (vitest, no DOM):
- `getItemBeatQuantityRange`: stack (shale 1..10), unique (Cutter fixed 1),
  unknown → undefined.
- `resolveDialogueItem` happy path + unknown-ID safe fallback.
- Validation: item beat with unknown id rejected; qty 0 / over stackLimit /
  non-integer rejected; unique qty≠1 rejected; NPC beats unaffected.
- Migration: v1 payload (old key + shape) → loads as v2 with `kind:"npc"` on all
  beats incl. checkpoints; v3 → untouched unsupported.
- Export: item beat round-trips `itemId` + `quantity` deterministically.

E2E (canonical runner phases):
- walk-it-off spec: after Claim Cutter success, assert
  `[data-dialogue-subject="item"]` visible with cutter art alt text, NO
  `[data-portrait...]` img in that beat, then Next → Tansy portrait returns.
  Capacity-refusal test (if cheaply reachable) asserts subject stays npc.
- qc-studio spec: switch a beat to Item, pick Salvage Cutter (qty locked 1),
  pick Ferrite Shale, set qty 3, assert preview shows item + label, export JSON
  contains itemId/quantity. Production-mode 404/200 flag check covered at unit/
  build level instead of spinning a prod server locally.

## Risks

- Authored-beat type migration touches many lines — mechanical, compiler-driven.
- `satisfies Record<DialogueId, DialogueSequence>` keeps catalog exhaustive.
- Prettier/lint parity: run `pnpm lint` + `npx prettier --write` on touched
  files before pushing (CI format:check trap).
- Manifest upkeep: roll #107 into latestCompleted, set currentChange to this PR.
