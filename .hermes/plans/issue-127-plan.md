# Issue #127 — Extract generic play orchestration/state boundary from the Mining feature

**Status:** Plan v4 — approved for implementation (Brandon's final correction incorporated, no further checkpoint)
**Branch:** `feat/issue-127-shared-play-orchestration` (fresh from `origin/main` `c15c0d6`)
**Issue:** https://github.com/BDubDesigns/RuneSpace/issues/127
**Type:** Behavior-preserving architecture/ownership refactor. No gameplay, balance, persistence, timing, concurrency, mission, or UI changes. No schema migration. No plugin framework.

---

## 0. Revision notes

### v3 → v4 (final correction from Brandon's third review — client shell + actions generics)

1. **Generic player-facing composition shell stops being Mining-owned.** `features/mining/MiningPlayScreen.tsx` (GameShell/top bar/footer/PlayProvider) and `features/mining/MiningConsole.tsx` (composes Refining, Travel, Scavenging, Cargo Hold, Power Annex, missions, NPC, location presentation, Inventory, Equipment) are the generic play shell — leaving them Mining-named preserves the ownership lie #127 removes. Both move to `features/play/`:
   - `features/play/PlayScreen.tsx` (was MiningPlayScreen) — generic shell: GameShell, top bar, footer, PlayProvider.
   - `features/play/PlayConsole.tsx` (was MiningConsole) — generic play composition: location routing, scene header, all shared panels, boundary-refresh wiring, clock.
   - `features/mining/MiningActivity.tsx` (new) — the Mining-specific controls/result presentation extracted from the console (Start/Stop/Refresh Mining, success chance, power-cell boost, progress meter, `LatestAttemptResult`, mining stop messages, feedback/recovery) with its own command machinery (mirrors RefiningConsole's self-contained pattern).
   - Actual Mining-specific components stay in `features/mining/` (MiningRunPanel, latest-result, inventory/equipment panels) and are consumed by the generic composition.
   - `app/play/[characterId]/page.tsx` imports `PlayScreen` from `@/features/play/PlayScreen`. §9.
2. **Generic server-action names in `server/actions.ts`.** `MiningActionResult`, `runMiningAction`, `refreshMiningAction` serve Refining/Welding/Travel/Equipment/Cargo — rename to feature-neutral `PlayActionResult`, `runPlayAction`, `refreshPlayAction`. `startMiningAction`/`stopMiningAction` remain Mining-named (they are Mining). Consumers (`RefiningConsole`, `PlayConsole`, `CargoHoldPanel`, `beginTravelAction` etc.) update. §9b.
3. **Structural proof extended:** no non-Mining feature depends on Mining-named generic play APIs (`refreshMiningAction`, `MiningActionResult`, `useMiningPlay`, `MiningPlayContext`), and the route-level/shared play shell is no longer Mining-owned (`features/mining/MiningPlayScreen.tsx` absent; `app/play/[characterId]/page.tsx` imports `@/features/play`). §11a.
4. **Commit-sequence typo fixed:** "move Mining RNG under Refining ownership" → "move **Refining RNG** under Refining ownership". §14.

### v2 → v3 (3 corrections from Brandon's second review)

1. **Mining command cycle resolved symmetrically with Refining.** v2 left `startFerriteShaleMining` / `stopMining` / `loadSalvageCutterPowerCell` in `server/mining.ts`, which would require `mining → play` and recreate the cycle. Correction: move play-dependent Mining command entrypoints to a leaf **`server/mining-commands.ts`** (implementation-owned name) that may depend on both `server/mining.ts` (resolver, Mining snapshot, Mining RNG) and `server/play.ts` (resolver composition, state assembly, provisioning). `server/mining.ts` becomes strictly resolver/Mining-state/RNG-focused with **no** `play` import. §3, §5, §8.
2. **RNG ownership/API cleanup.** `defaultRefiningRandom` / the Refining E2E random source move under **Refining ownership** (`server/refining.ts`). `createPlayResolver` owns default resolver/random wiring so generic callers (Inventory/Missions/Equipment/Cargo) no longer import Mining just for `defaultMiningRandom`. Behavior preserved exactly: outside the canonical-E2E override, a caller-supplied random feeds both Mining and Refining as today; under `CI && RUNESPACE_E2E_MINING && localhost`, Refining uses its deterministic E2E sequence. Focused parity test retained. §3a.
3. **Structural test 11a.5 fixed.** `refining-commands → refining` (runtime `createRefiningResolver`) is a valid leaf dependency and must not be forbidden. The cycle assertions that matter: `server/refining.ts` does NOT import `server/play.ts`, and `server/mining.ts` does NOT import `server/play.ts`. `refining-commands → {refining, play}` and `mining-commands → {mining, play}` are both allowed leaf edges. §11a.

### v1 → v2 (previous revision — 5 architecture blockers, resolved)

1. Single resolver-construction owner (`server/play.ts`; no mining wrapper).
2. `stateFromTransaction` unblocked via extracted shared loader (`server/play-state.ts`).
3. Refining commands in a leaf module to avoid `refining ↔ play` cycle.
4. `ensureStarterMiningState` → generic `ensurePlayProvisioning` in play layer.
5. Type-sound registry dispatching `persist` on `context.action.actionId` (no outcome-shape discrimination).

---

## 1. Goal (unchanged from issue)

RuneSpace's application-wide play orchestration currently lives inside the Mining feature:

- **Server:** `server/mining.ts` owns `createPlayResolver()` (composes Mining/Refining/Travel/Welding resolvers), `stateFromTransaction()` (assembles the full authoritative play state), and the `MiningGameplayState` type (contains Mining + Refining + Travel + Cargo + Inventory + equipment + missions + Scavenging).
- **Client:** `features/mining/MiningPlayContext.tsx` owns the shared command gate, foreground/background busy state, queued foreground intent, boundary-refresh scheduler, and drawer state — consumed as `useMiningPlay()` by NPC, Refining, Travel, Cargo, Power Annex, and missions surfaces.

After this issue, ownership matches responsibility:

- Generic transaction/action lifecycle stays in `server/action-resolution.ts` (unchanged semantics).
- Shared play orchestration moves to feature-neutral `server/play.ts` (+ `server/play-state.ts` for shared state loading).
- Each activity's resolver and command entrypoints live in activity-owned modules (`server/mining.ts` + `server/mining-commands.ts`, `server/refining.ts` + `server/refining-commands.ts`, `server/travel.ts`, `server/welding.ts`).
- Shared React play context moves to feature-neutral `features/play/PlayContext.tsx` exposing `PlayProvider` / `usePlay`.
- Non-Mining features stop importing Mining module names for generic play state.

## 2. Current ownership (verified on `origin/main` @ `c15c0d6`)

See v1 §2 (verified grep tables). Facts that drive this revision:

- `action-resolution.ts` `ActionResolver.persist(tx, outcome, context?)` receives the **original `ActiveAction`** in `context.action` (line 160) — the hook for type-sound persist dispatch.
- Every activity resolver's `supports` is a clean `actionId` predicate:
  - Mining: `action.actionId === ACTION_IDS.ferriteShaleMining`
  - Refining: `action.actionId === ACTION_IDS.refining`
  - Welding: `action.actionId === ACTION_IDS.cargoHoldWelding`
  - Travel: `action.actionId === ACTION_IDS.travel`
- **All five play-dependent command entrypoints** (`startFerriteShaleMining`, `startRefining`, `stopRefining`, `stopMining`, `loadSalvageCutterPowerCell`) default `random = defaultMiningRandom()` and call `createPlayResolver` via `withResolvedOwnedCharacter` — they all need the play layer, confirming correction 1.
- `loadMiningSnapshot` (mining-private) is used at: resolver `load` (567), `stateFromTransaction` (777), `startFerriteShaleMining` preflight (1283), `claimScavenge` (2133). After extraction: state assembly + scavenge use `loadPlaySnapshot`; resolver + mining preflight keep a Mining snapshot (derived from the shared loader).
- `defaultRefiningRandom` (mining.ts:138) + inline `e2eRefiningRandom` are Refining RNG sources owned by mining.ts — correction 2 moves them under Refining.

## 3. Blocker 1 + correction 1 — single owner for composed resolver construction; Mining commands in a leaf

### 3a. `server/play.ts` is the sole owner of resolver composition AND default random wiring

```ts
// server/play.ts
import { createMiningResolver, defaultMiningRandom } from "@/server/mining";
import { createRefiningResolver, e2eRefiningRandom } from "@/server/refining";
import { createTravelResolver } from "@/server/travel";
import { createWeldingResolver } from "@/server/welding";

export function createPlayResolver(
  random: MiningRandom = defaultMiningRandom(),  // default wiring owned here
  callbacks?: { onMiningOutcome?; onTravelArrival?; onRefiningOutcome?; onWeldingOutcome? },
): PlayResolver {
  const refiningRandom =
    isCanonicalE2EMiningOverride() ? e2eRefiningRandom() : random;
  const resolvers: readonly PlayResolverEntry[] = [
    { actionId: ACTION_IDS.ferriteShaleMining, resolver: createMiningResolver(random, callbacks?.onMiningOutcome) },
    { actionId: ACTION_IDS.refining, resolver: createRefiningResolver(refiningRandom, callbacks?.onRefiningOutcome) },
    { actionId: ACTION_IDS.travel, resolver: createTravelResolver() },
    { actionId: ACTION_IDS.cargoHoldWelding, resolver: createWeldingResolver(callbacks?.onWeldingOutcome) },
  ];
  return composePlayResolvers(resolvers);
}
```

- **RNG behavior preserved exactly** (correction 2):
  - Outside the canonical-E2E override, `random` (caller-supplied, or `defaultMiningRandom()` if omitted) feeds **both** Mining and Refining — identical to today (mining.ts:685-696 uses `random` for refining in the non-CI branch).
  - Under `CI && RUNESPACE_E2E_MINING && localhost` (`isCanonicalE2EMiningOverride()`), Refining uses `e2eRefiningRandom()` — identical to today.
  - `defaultRefiningRandom` (the public factory) moves to `server/refining.ts` under Refining ownership; `play.ts` imports `e2eRefiningRandom` from `@/server/refining` and applies the override ternary itself. The `isCanonicalE2EMiningOverride()` predicate (host check on `DATABASE_URL`) is a small helper owned by play.ts (or refining.ts — implementation-owned; it is the canonical-E2E condition, a play-level concern).
  - `defaultMiningRandom` stays mining-owned (mining RNG); `createPlayResolver`'s default parameter means generic callers (Inventory/Missions/Equipment/Cargo) no longer import it — they call `createPlayResolver()` or `createPlayResolver(customRandom)`. **Callers that currently pass `defaultMiningRandom()` explicitly switch to omitting the arg.**

### 3b. `server/mining.ts` — resolver/Mining-state/RNG-focused, no `play` import

Keeps (Mining-owned):

- `defaultMiningRandom` (mining RNG; incl. `e2eMiningRandom`, `systemRandom` internals)
- `MiningRunAttempt`, `MiningRunState`
- `MiningSnapshot` (internal), `PersistedMiningOutcome` (internal), `loadMiningSnapshot` (**exported** so `mining-commands.ts` can use the Mining preflight — see §5)
- `createMiningResolver`
- Mining persistence helpers used only by the resolver

Removes (moved to play / commands / refining):

- `createPlayResolver`, `stateFromTransaction`, `getMiningGameplayState` → `server/play.ts`
- `MiningGameplayState` → `PlayGameplayState` in `server/play.ts`
- `ActivityStop`, `CargoHold*`, `Scavenge*` → `server/play.ts`
- `beginTravel`, `claimScavenge`, `acknowledgeScavengeReveal` → `server/play.ts`
- `startFerriteShaleMining`, `stopMining`, `loadSalvageCutterPowerCell` (+ `LoadPowerCell*` types) → `server/mining-commands.ts`
- `startRefining`, `stopRefining` → `server/refining-commands.ts`
- `defaultRefiningRandom`, `e2eRefiningRandom` → `server/refining.ts`
- `ensureStarterMiningState` → `ensurePlayProvisioning` in `server/play.ts`
- `RefiningRunAttempt`, `RefiningRunState` → deleted (refining.ts already owns them)
- `loadMiningSnapshot`'s shared rows → via `loadPlaySnapshot` (see §4)

**`server/mining.ts` imports `server/play-state.ts` (for `loadPlaySnapshot`) but never `server/play.ts`.** The only play/mining edge is `play → mining` (for `createMiningResolver` + `defaultMiningRandom`), plus leaf `mining-commands → {mining, play}`.

## 4. Blocker 2 — extract the generic shared state loader

### New: `server/play-state.ts`

```ts
export type PlaySnapshot = {
  xpRows; stacks; allItemInstances; carriedInstances;
  equipmentLoadout: EquipmentLoadout;
  slotsUsed; slotCapacity; slotsAvailable; massAvailableGrams;
  carriedMassGrams; maximumCarryCapacityGrams;
  carriedPowerCellQuantity;
};

export async function loadPlaySnapshot(transaction, characterId): Promise<PlaySnapshot>;
```

- Same 4 tables, same `FOR UPDATE` order as today's `loadMiningSnapshot` (behavior-preserving locking).
- Used by `stateFromTransaction` (play.ts) and `claimScavenge` (play.ts).
- `server/mining.ts`'s `loadMiningSnapshot` becomes a thin Mining-specific derivation: calls `loadPlaySnapshot` internally, then computes `miningLevel`, `hasCompatibleTool`, `equippedCutterInstanceId`, `cutterCharge` from the shared snapshot + balance. No duplicate row loads.
- `startFerriteShaleMining`'s preflight (`miningPreflightStopReason(snapshot, ...)`) needs the Mining snapshot — `mining-commands.ts` imports the exported `loadMiningSnapshot` from `@/server/mining`.

## 5. Correction 1 — Mining command entrypoints in a leaf

### New: `server/mining-commands.ts` (implementation-owned name)

Moves `startFerriteShaleMining`, `stopMining`, `loadSalvageCutterPowerCell` (+ `LoadPowerCellStatus` / `LoadPowerCellResult` / `LoadPowerCellSelection` types).

```ts
// server/mining-commands.ts
import { loadMiningSnapshot, type MiningRunAttempt } from "@/server/mining";
import { createPlayResolver, ensurePlayProvisioning, stateFromTransaction } from "@/server/play";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
```

- `startFerriteShaleMining` uses `loadMiningSnapshot` for the Mining preflight; the rest flows through `createPlayResolver` + `stateFromTransaction` + `ensurePlayProvisioning` (all from play).
- `stopMining`, `loadSalvageCutterPowerCell` move as-is (same bodies, updated type name `PlayGameplayState`).
- This is the symmetric analogue of `refining-commands.ts`.

### New: `server/refining-commands.ts`

Moves `startRefining`, `stopRefining` (from mining.ts). Preferred implementation: direct `createRefiningResolver` (these commands only ever touch the refining action) + `stateFromTransaction` / `ensurePlayProvisioning` from play. Fallback: full play resolver — both acyclic via the leaf module.

## 6. Blocker 4 — `ensureStarterMiningState` → `ensurePlayProvisioning`

Renamed + moved to `server/play.ts`, body unchanged, docstring states the multi-activity provisioning responsibility (skill rows for Mining/Refining/Welding/Strength, Mining/Refining persistence rows, Cargo Hold repair, starter container/equipment). All 8 callers update. `ensureCargoHoldRepairState` stays in `server/welding.ts`; play already imports welding for the resolver. Structural test asserts the old identifier is absent repo-wide.

## 7. Blocker 5 — type-sound resolver registry with action-based persist dispatch

### Registry

```ts
type PlayResolverEntry = {
  resolver: ActionResolver<unknown, unknown>;
  actionId: string;   // the single actionId this resolver owns
};

export function composePlayResolvers(entries: readonly PlayResolverEntry[]): PlayResolver {
  const byActionId = new Map(entries.map((e) => [e.actionId, e]));
  return {
    supports: (action) => byActionId.has(action.actionId),
    load: (tx, input) => byActionId.get(input.action.actionId)!.resolver.load(tx, input),
    resolve: (input) => byActionId.get(input.action.actionId)!.resolver.resolve(input),
    persist: (tx, outcome, context) => {
      const entry = byActionId.get(context!.action.actionId)!;  // original action from action-resolution.ts:160
      return entry.resolver.persist(tx, outcome, context);
    },
  };
}
```

- **persist dispatches on `context.action.actionId`** — the original action supplied by `withResolvedOwnedCharacter`. No outcome-shape discrimination (`resolvedAttempts !== undefined` etc. gone).
- The **only** casts: each typed `ActionResolver<Snapshot, Outcome>` → `ActionResolver<unknown, unknown>` at the registry boundary (one documented spot per entry, in `createPlayResolver`). Replaces the current ~12 per-branch `as unknown` casts in load/resolve/persist.
- `action-resolution.ts` is **not modified** — semantics unchanged.

## 8. Final dependency graph (v3)

```
app/play/[characterId]/page.tsx
  → server/play.ts (getPlayGameplayState)
  → features/play/PlayContext.tsx (PlayProvider)
  → features/mining/MiningPlayScreen.tsx (shell)

features/* (non-mining: travel, refining, npc, cargo, power-annex, missions)
  → features/play/PlayContext.tsx (usePlay)
  → server/play.ts (PlayGameplayState + per-feature types)
  → server/refining.ts (RefiningRunAttempt/State — refining-owned types)

server/play.ts
  → server/action-resolution.ts   (seam, unchanged)
  → server/play-state.ts          (loadPlaySnapshot)
  → server/mining.ts              (createMiningResolver, defaultMiningRandom)   ← the ONLY play→mining edge
  → server/refining.ts            (createRefiningResolver, e2eRefiningRandom)
  → server/travel.ts              (createTravelResolver)
  → server/welding.ts             (createWeldingResolver, ensureCargoHoldRepairState)
  → server/mission-state.ts       (loadMissionProjections)
  → server/carried-inventory.ts   (addStackableItem etc.)
  → server/progression.ts         (grantCharacterSkillXp)
  → game/*, db/*

server/play-state.ts
  → server/action-resolution.ts, server/carried-inventory.ts, game/domain/equipment.ts, db/*

server/mining.ts
  → server/action-resolution.ts
  → server/play-state.ts          (loadPlaySnapshot)
  → game/domain/mining.ts, db/*
  (NO import of server/play.ts)                                  ← cycle guard 1

server/refining.ts
  → server/action-resolution.ts
  → server/play-state.ts          (if needed)
  → game/domain/refining.ts, db/*
  (NO import of server/play.ts)                                  ← cycle guard 2

server/mining-commands.ts   (new leaf)
  → server/mining.ts              (loadMiningSnapshot, Mining types)
  → server/play.ts                (createPlayResolver, stateFromTransaction, ensurePlayProvisioning, PlayGameplayState)
  → server/action-resolution.ts

server/refining-commands.ts  (new leaf)
  → server/refining.ts            (createRefiningResolver, types)
  → server/play.ts                (createPlayResolver or stateFromTransaction, ensurePlayProvisioning, PlayGameplayState)
  → server/action-resolution.ts

server/inventory.ts / missions.ts / equipment.ts / cargo-hold.ts / power-annex.ts
  → server/play.ts                (createPlayResolver, stateFromTransaction, ensurePlayProvisioning, PlayGameplayState)
  → server/action-resolution.ts
  (NO import of server/mining.ts after the change)
```

**Cycle check (all edges one-directional):**
- `play → mining` only; `mining → play` **absent** (mining.ts imports play-state, not play). ✓
- `play → refining.ts`; `refining.ts → play` **absent** (refining-commands carries the play-facing commands). ✓
- `mining-commands → {mining, play}` and `refining-commands → {refining, play}` are **leaf** dependencies (nothing imports the command modules). ✓
- `play → play-state`; `mining → play-state`; `refining → play-state` (optional). ✓ leaf
- All other consumers → play, acyclic. ✓

## 9. Client extraction — generic play shell stops being Mining-owned (v4)

### 9a. `features/play/` — the generic player-facing play shell

- `features/play/PlayContext.tsx` — `PlayProvider` / `usePlay` (renamed from `MiningPlayProvider`/`useMiningPlay`), imports `PlayGameplayState` from `@/server/play`.
- `features/play/command-gate.ts` — moved from `features/mining/command-gate.ts` (pure generic gate).
- `features/play/PlayScreen.tsx` — **was `features/mining/MiningPlayScreen.tsx`**. The generic route shell: `GameShell`, `TopBar`, footer (Chars/Inventory/Equipment buttons), hosts `PlayProvider`. Renamed export `PlayScreen`.
- `features/play/PlayConsole.tsx` — **was `features/mining/MiningConsole.tsx`** (552 lines). The generic play composition:
  - Location routing (`atTheJag` → MiningActivity, `atProcessingYard` → RefiningConsole, `crashSite` → CargoHoldPanel, transit → journey copy, else location description).
  - Shared panels: `LocationSceneHeader`, `MissionObjectivePanel`, `NpcInteractionPanel`, `ScavengeRevealOverlay`, `LocalMapPanel`, `PowerAnnexClaimPanel`, `CargoReadout`, skill `SkillProgressCard`s, `MiningRunPanel`/`RefiningRunPanel`, Inventory/Equipment drawers.
  - The shared command machinery (`apply`/`executeCommand`/`runForeground`/`command`, boundary-refresh `setRefreshCallback`, clock) — **generic** (uses `refreshPlayAction`).
  - Mining-specific controls/result presentation **extract to `features/mining/MiningActivity.tsx`** (below).
- `app/play/[characterId]/page.tsx` — imports `PlayScreen` from `@/features/play/PlayScreen` and `getPlayGameplayState` from `@/server/play`.

### 9b. `features/mining/` — Mining-specific surface only

- `features/mining/MiningActivity.tsx` (new) — the Mining-specific activity card extracted from the console: Start/Stop/Refresh Mining buttons, success-chance + power-cell-boost readouts, progress `StatusMeter`, `LatestAttemptResult`, mining stop messages, quest-guidance `startMiningGuided`, command feedback/recovery — all Mining-specific. It uses `usePlay()` (the generic context) + `startMiningAction`/`stopMiningAction`/`refreshPlayAction` (generic refresh). Mirrors `RefiningConsole`'s self-contained command pattern.
- `features/mining/MiningRunPanel.tsx`, `latest-result.ts`, `InventoryPanel.tsx`, `EquipmentPanel.tsx`, `useEquipCommand.ts`, `useLoadPowerCell.ts`, `inventory-selection.ts` — stay Mining-owned, consumed by the generic composition.
- `features/mining/MiningPlayScreen.tsx`, `MiningConsole.tsx` — **deleted** (replaced by PlayScreen/PlayConsole/MiningActivity).
- `features/mining/command-gate.ts` — **deleted** (moved to `features/play/command-gate.ts`).

### 9c. Non-mining consumers (verified)

Switch `useMiningPlay` → `usePlay` from `@/features/play/PlayContext`: `features/refining/RefiningConsole.tsx`, `features/travel/{ScavengeControl,LocalMapPanel,ScavengeRevealOverlay}.tsx`, `features/cargo/CargoHoldPanel.tsx`, `features/power-annex/PowerAnnexClaimPanel.tsx`, `features/npc/NpcInteractionPanel.tsx`.

### 9d. Generic server-action names (`server/actions.ts`)

- `MiningActionResult` → `PlayActionResult`
- `runMiningAction` → `runPlayAction`
- `refreshMiningAction` → `refreshPlayAction`
- `startMiningAction` / `stopMiningAction` — **remain Mining-named** (genuinely Mining).
- Consumers update: `features/refining/RefiningConsole.tsx` (`refreshPlayAction`, `startRefiningAction`, `stopRefiningAction`), `features/mining/MiningActivity.tsx` (`startMiningAction`, `stopMiningAction`, `refreshPlayAction`), `features/play/PlayConsole.tsx` (`refreshPlayAction`), `features/cargo/CargoHoldPanel.tsx` (`PlayActionResult`), and `beginTravelAction`/`equipEquipmentAction`/etc. return types.
- Structural proof: `grep` for `MiningActionResult`/`refreshMiningAction`/`runMiningAction` in non-Mining dirs → zero hits (§11a).

### 9e. Why this is ownership/movement only, not a UI redesign

- `PlayConsole` keeps the exact JSX/layout/behavior of `MiningConsole`; only the module + export names change.
- `MiningActivity` is a pure extraction of the Mining branch (the `atTheJag && !inTransit` block) — same buttons, same readouts, same logic.
- The route page renders the same tree; preview should be pixel-identical.

## 10. Type ownership after extraction

| Type | New home | Imported by |
|---|---|---|
| `PlayGameplayState` (was `MiningGameplayState`) | `server/play.ts` | all play-state consumers |
| `ActivityStop` | `server/play.ts` | consoles |
| `CargoHoldStackState/UniqueItemState/State` | `server/play.ts` | cargo + inventory |
| `ScavengeResolvedOutcome/ClaimStatus/ClaimResult/Reveal/AcknowledgmentResult` | `server/play.ts` | travel + actions |
| `MiningRunAttempt/MiningRunState` | `server/mining.ts` | mining feature |
| `LoadPowerCellStatus/Result/Selection` | `server/mining-commands.ts` (or mining.ts — Mining-owned) | mining feature + actions |
| `RefiningRunAttempt/RefiningRunState` | `server/refining.ts` (already exists) | refining feature (delete mining.ts copies) |
| `MiningRandom` | `game/domain/mining.ts` (already) | unchanged |
| `defaultMiningRandom` | `server/mining.ts` (stays) | play.ts default wiring only |
| `defaultRefiningRandom`, `e2eRefiningRandom` | `server/refining.ts` | play.ts override ternary |

## 11. Tests / proof

### 11a. Structural/unit proof (new `tests/unit/play-orchestration-boundary.test.ts`)

Node fs/grep-based, no DB, fast:

1. `server/play.ts` exports `createPlayResolver`, `stateFromTransaction`, `PlayGameplayState`, `ActivityStop`, `CargoHold*`, `Scavenge*`, `getPlayGameplayState`, `ensurePlayProvisioning` — and its only `@/server/mining` imports are `createMiningResolver` + `defaultMiningRandom`.
2. `server/mining.ts` no longer exports `MiningGameplayState` / `createPlayResolver` / `stateFromTransaction` / `getMiningGameplayState` / `beginTravel` / `claimScavenge` / `acknowledgeScavengeReveal` / `startFerriteShaleMining` / `stopMining` / `loadSalvageCutterPowerCell` / `startRefining` / `stopRefining` / `RefiningRunAttempt` / `RefiningRunState` / `ensureStarterMiningState` / `defaultRefiningRandom` / `e2eRefiningRandom`.
3. **Cycle guards (corrected per review):**
   - `server/mining.ts` does NOT import `@/server/play`.
   - `server/refining.ts` does NOT import `@/server/play`.
   - `server/play.ts` does NOT import `@/server/refining-commands` or `@/server/mining-commands`.
   - `server/mining-commands.ts → server/mining.ts` and `server/mining-commands.ts → server/play.ts` are **allowed** (leaf).
   - `server/refining-commands.ts → server/refining.ts` (runtime `createRefiningResolver`) and `server/refining-commands.ts → server/play.ts` are **allowed** (leaf).
4. No non-Mining feature module imports `@/features/mining/MiningPlayContext` or `useMiningPlay` (grep `features/{refining,travel,npc,cargo,power-annex,missions}/**`).
5. No non-Mining module references `MiningActionResult` / `refreshMiningAction` / `runMiningAction` (grep all non-`features/mining` dirs) — the generic play action names are feature-neutral.
6. `features/mining/MiningPlayScreen.tsx` and `features/mining/MiningConsole.tsx` no longer exist; `app/play/[characterId]/page.tsx` imports the play shell from `@/features/play/PlayScreen`.
7. No module imports `RefiningRunAttempt`/`RefiningRunState` from `@/server/mining`.
8. `ensureStarterMiningState` identifier appears nowhere in the repo (renamed to `ensurePlayProvisioning`).

### 11b. Resolver regression (integration — existing suites are the proof)

- Mining: `tests/integration/gameplay-foundations.test.ts` + mining E2E.
- Refining: `tests/integration/refining.test.ts` (uses play resolver path).
- Travel: `tests/integration/travel.test.ts` + `scavenge.test.ts`.
- Welding: `tests/integration/cargo-hold.test.ts` (startCargoHoldWelding flow).
- Update their `@/server/mining` imports to the new homes; suites keep passing → dispatch unchanged.
- `tests/integration/inventory-discard.test.ts`, `power-cell-boost.test.ts` → `createPlayResolver`/`ensurePlayProvisioning` from `@/server/play`.

### 11c. Client command-gate regression

`tests/unit/command-gate.test.ts` (192 lines) — import updates only (`@/features/play/command-gate`), assertions unchanged.

### 11d. Focused RNG parity test (retained per correction 2)

Asserts:
- Under `CI && RUNESPACE_E2E_MINING && localhost`, the composed resolver's refining path produces the deterministic `[0, 9000]` alternating sequence (Slag on attempt 2).
- Outside that override, a caller-supplied `random` feeds both Mining and Refining (verify via the resolver's load/resolve inputs or a stub random asserting both resolvers receive it).
- `defaultRefiningRandom`/`e2eRefiningRandom` live in `server/refining.ts` (structural).

### 11e. Full validation (AGENTS.md parity)

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm format:check` (prettier, after `prettier --write` on touched files)
5. `pnpm test` (unit; `VITEST_CACHE_DIR=/tmp/<label>` if cache issue)
6. `node scripts/runespace-db.mjs create issue-127 && node scripts/runespace-db.mjs run issue-127 -- pnpm test:integration --cache=false`
7. `pnpm build` (CI placeholder env: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RUNESPACE_RELEASE_ID`)
8. Canonical E2E: `node scripts/runespace-db.mjs run issue-127 -- pnpm test:e2e:canonical`
9. CI on the PR (fast-checks + full gate) green on final head SHA.

No player-visible diff expected; preview should behave identically.

## 12. File-by-file change list

### New files
- `server/play.ts` — generic play orchestration: `PlayGameplayState`, `ActivityStop`, `CargoHold*`, `Scavenge*`, `composePlayResolvers` + `createPlayResolver` (constructs 4 resolver entries, owns default random wiring), `stateFromTransaction`, `getPlayGameplayState`, `beginTravel`, `claimScavenge`, `acknowledgeScavengeReveal`, `ensurePlayProvisioning` (renamed), `recentFrom`/`refiningRecentFrom` helpers.
- `server/play-state.ts` — `loadPlaySnapshot` (shared xp/stacks/instances/equipment loading).
- `server/mining-commands.ts` — `startFerriteShaleMining`, `stopMining`, `loadSalvageCutterPowerCell` (+ `LoadPowerCell*` types).
- `server/refining-commands.ts` — `startRefining`, `stopRefining` (preferred: direct `createRefiningResolver` + play state assembly).
- `features/play/PlayContext.tsx` — `PlayProvider` / `usePlay`.
- `features/play/PlayScreen.tsx` — generic route shell (was `MiningPlayScreen.tsx`).
- `features/play/PlayConsole.tsx` — generic play composition (was `MiningConsole.tsx`).
- `features/play/command-gate.ts` — moved from `features/mining/command-gate.ts`.
- `features/mining/MiningActivity.tsx` — Mining-specific activity card (extracted from console).
- `tests/unit/play-orchestration-boundary.test.ts` — structural ownership assertions (11a).

### Moved/renamed
- `features/mining/MiningPlayContext.tsx` → deleted (replaced by `features/play/PlayContext.tsx`).
- `features/mining/MiningPlayScreen.tsx` → deleted (replaced by `features/play/PlayScreen.tsx`).
- `features/mining/MiningConsole.tsx` → split into `features/play/PlayConsole.tsx` + `features/mining/MiningActivity.tsx`.
- `features/mining/command-gate.ts` → `features/play/command-gate.ts`.
- `ensureStarterMiningState` → `ensurePlayProvisioning` in `server/play.ts`.
- `MiningGameplayState` → `PlayGameplayState` in `server/play.ts`.
- `RefiningRunAttempt`/`RefiningRunState` copies deleted from mining.ts (refining.ts already has them).
- `defaultRefiningRandom`/`e2eRefiningRandom` → `server/refining.ts`.
- `MiningActionResult`/`runMiningAction`/`refreshMiningAction` → `PlayActionResult`/`runPlayAction`/`refreshPlayAction` in `server/actions.ts` (start/stopMiningAction stay).

### Edited
- `server/mining.ts` — strip generic exports + command entrypoints; keep `createMiningResolver`, Mining RNG (`defaultMiningRandom`), Mining run types, exported `loadMiningSnapshot` (derives from `loadPlaySnapshot`); no `play` import.
- `server/refining.ts` — add `defaultRefiningRandom`/`e2eRefiningRandom`; already exports run types + resolver.
- `server/actions.ts` — imports: `getPlayGameplayState`, `beginTravel`/`claimScavenge`/`acknowledgeScavengeReveal`/`PlayGameplayState` from `@/server/play`; `startFerriteShaleMining`/`stopMining`/`loadSalvageCutterPowerCell` from `@/server/mining-commands`; `startRefining`/`stopRefining` from `@/server/refining-commands`.
- `server/inventory.ts`, `server/missions.ts`, `server/equipment.ts`, `server/cargo-hold.ts`, `server/power-annex.ts` — import updates (`createPlayResolver`/`stateFromTransaction`/`ensurePlayProvisioning`/`PlayGameplayState` from `@/server/play`; drop `defaultMiningRandom` — `createPlayResolver` defaults it).
- `app/play/[characterId]/page.tsx` — `getPlayGameplayState` from `@/server/play`.
- 10 feature files — import updates (`usePlay` from `@/features/play/PlayContext`; `PlayGameplayState`/`RefiningRun*`/`CargoHold*`/`Scavenge*` from correct homes; `refreshPlayAction`/`PlayActionResult` renames in RefiningConsole, CargoHoldPanel).
- `tests/unit/command-gate.test.ts`, `tests/integration/inventory-discard.test.ts`, `tests/integration/power-cell-boost.test.ts`, `tests/unit/inventory-generic-details.test.ts`, `tests/unit/inventory-selection.test.ts` — import updates.
- `docs/architecture.md` / `docs/component-boundaries.md` — update module map if they reference mining.ts as the orchestrator (verify during implementation).

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| RNG parity regression (refining e2e RNG selection / caller random feeding both) | §3a pinned; focused test 11d; canonical E2E catches |
| Import cycle (`play ↔ mining`, `refining.ts ↔ play`) | Structural tests 11a.3 + graph §8; single-direction edges enforced |
| `loadPlaySnapshot` lock-order change alters concurrency | Extract from the exact existing query order; integration tests as guard |
| Missed importer → typecheck fails | All import sites mechanical; `pnpm typecheck` is the gate |
| `persist` context absent | `withResolvedOwnedCharacter` always passes it (action-resolution.ts:160); registry throws a clear error if absent |
| Mining preflight (`startFerriteShaleMining`) loses snapshot access | `loadMiningSnapshot` exported from mining.ts; mining-commands imports it |
| Large rename reviewability | No runtime re-exports; all consumers switch in the same PR; structural tests assert absence of Mining names |
| Docs stale | Update module map if mining.ts referenced as orchestrator |

## 14. Commit sequence

1. `refactor(issue-127): add server/play-state.ts shared play snapshot loading` — extract `loadPlaySnapshot`; mining resolver derives from it. (No behavior change.)
2. `refactor(issue-127): add server/play.ts generic play orchestration` — move generic types + `composePlayResolvers`/`createPlayResolver` (default RNG wiring) + `stateFromTransaction` + `getPlayGameplayState` + travel/scavenge commands + `ensurePlayProvisioning`.
3. `refactor(issue-127): move Refining RNG under Refining ownership (server/refining.ts)` — `defaultRefiningRandom`/`e2eRefiningRandom`; play.ts override ternary.
4. `refactor(issue-127): add server/mining-commands.ts and server/refining-commands.ts` — move play-dependent command entrypoints out of mining.ts.
5. `refactor(issue-127): move play context and play shell to features/play` — PlayContext + command-gate + PlayScreen/PlayConsole; extract MiningActivity; all client consumers; rename generic actions (refreshPlayAction/PlayActionResult).
6. `refactor(issue-127): rewire server modules + app page + tests to new homes` — finish import updates; generic callers drop `defaultMiningRandom`.
7. `test(issue-127): add structural ownership boundary tests + RNG parity guard` + docs module map update.
8. Full validation; fix; `prettier --write`; commit format fixes.
9. Open draft PR `Closes #127` (remove `.hermes/plans/issue-127-plan.md` before ready per factory gate).

## 15. Definition of done

- [ ] All acceptance criteria in issue #127 tick.
- [ ] `server/play.ts` is the **sole** owner of resolver composition + state assembly + play types + play provisioning + default random wiring; `server/mining.ts` and `server/refining.ts` are resolver/activity-focused and do **not** import `server/play.ts`.
- [ ] `server/play-state.ts` owns the shared carried/equipment/play-state loading (no duplication with activity resolver snapshots).
- [ ] `startFerriteShaleMining`/`stopMining`/`loadSalvageCutterPowerCell` live in `server/mining-commands.ts`; `startRefining`/`stopRefining` live in `server/refining-commands.ts`; both are leaf modules with no cycle.
- [ ] Refining RNG (`defaultRefiningRandom`/`e2eRefiningRandom`) owned by `server/refining.ts`; generic callers no longer import `defaultMiningRandom` (play defaults it).
- [ ] `ensureStarterMiningState` renamed/moved to generic play provisioning; identifier absent from repo.
- [ ] `features/play/PlayContext.tsx` exposes `PlayProvider`/`usePlay`; no non-Mining feature imports `MiningPlayContext`/`useMiningPlay`.
- [ ] `RefiningRunAttempt`/`RefiningRunState` imported from `@/server/refining` everywhere.
- [ ] Resolver persist dispatches on `context.action.actionId` (no outcome-shape discrimination); `as unknown` casts reduced to the registry boundary (documented).
- [ ] Refining CI RNG + caller-random behavior preserved (focused parity test green).
- [ ] typecheck / lint / format:check / unit / integration / build / canonical E2E all green locally + CI.
- [ ] Draft PR created, preview deployed, awaiting Brandon's merge authorization.
