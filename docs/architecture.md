# Architecture

## Direction: modular monolith

RuneSpace starts as a **modular monolith**: one repository, one application, one database, one deployment, with strong internal boundaries. There are **no** microservices, no multi-repository layout, and no premature monorepo tooling.

The internal boundaries below are enforced by convention and directory layout, not by separate deployables. When a boundary genuinely needs to scale independently (background workers, isolated minigame runtimes), that is a later, explicit decision.

## Server-authoritative game model

The browser is **never** the trusted source of progression. Inventories, XP, rewards, and action outcomes are resolved by server-authoritative domain logic and persisted server-side. Clients send intent; the server validates, resolves, and stores the result.

This means:

- Game rules live in `game/domain/` and are called from `server/`.
- React components never compute or store authoritative state.
- Any client-side value (a minigame score, a displayed timer) is treated as untrusted until re-validated by the server.

## Boundaries and dependency direction

```
app/            routes, layouts, pages (thin composition)
  │ uses
components/     reusable visual primitives (presentational)
features/       vertical features (composition + wiring to server)
  │ uses
server/         orchestration, authorized commands, persistence, timers
  │ uses
db/             Drizzle schema, migrations, narrow persistence code
game/domain/    pure rules, calculations, state transitions, IDs
game/content/   typed content definitions (data-driven)
game/schemas/   Zod validation for content + request boundaries
```

Dependency rules:

- `app/`, `components/`, `features/` may depend on `server/`, `game/*`, `db/`.
- `server/` depends on `game/*` and `db/`; it does **not** import React.
- `game/domain/` and `game/content/` are framework-free (no React, no Next.js, no `pg`). They are the pure core.
- `game/schemas/` depends only on Zod and the ID contract.
- `db/` depends on Drizzle, the schema in `db/schema.ts`, and `server/env.ts`.
- `minigames/` are isolated client-side boundaries; they talk to the app only through small typed contracts (no shared mutable game state).

Lower layers never import higher layers. Domain logic never imports UI.

## Player-intent flow

1. Player interacts in `app/` / `features/` (UI only).
2. UI calls a server action or route handler in `server/`.
3. `server/` authenticates, loads data via `db/`, and calls pure rules in `game/domain/`.
4. Domain rules resolve the outcome from authoritative inputs (content from `game/content/`, validated by `game/schemas/`).
5. `server/` persists the result through `db/`.
6. UI reflects the server-confirmed state.

## Play orchestration

RuneSpace's application-wide play boundary is **Play**, not Mining. Mining was the first vertical, so the generic shell was originally embedded in the Mining feature; since Issue #127 it has been extracted to its own Play ownership.

- **Generic transaction/action lifecycle:** `server/action-resolution.ts` owns `withResolvedOwnedCharacter` / `withLockedOwnedCharacter`, the durable action cursor, locking, lazy resolution, and transition (continue/stop/replace) semantics. It knows nothing about Mining, Refining, Travel, or Welding.
- **Generic Play state assembly:** `server/play.ts` owns `createPlayResolver`, `PlayGameplayState`, and shared state assembly/refresh; `server/play-state.ts` owns the shared `loadPlaySnapshot` read. Play dispatches persistence by the original `context.action.actionId`, hands authoritative resolved Mining/Refining attempt counts to generic mission progress before the action cursor advances, and refuses composed persistence when the original action context is absent.
- **Activity-specific resolvers:** Mining (`server/mining.ts`), Refining (`server/refining.ts`), Travel (`server/travel.ts`), and Welding (`server/welding.ts`) each retain their own resolver implementation. Leaf command modules (`server/mining-commands.ts`, `server/refining-commands.ts`, etc.) may depend on both their activity owner and the generic Play layer without creating cycles.
- **Generic client Play shell:** `features/play/PlayContext.tsx`, `features/play/PlayScreen.tsx`, `features/play/PlayConsole.tsx`, and `features/play/command-gate.ts` own the Play context, shell composition, command gate, and boundary refresh. They compose every activity surface (Mining, Refining, Travel, Scavenging, Cargo Hold, Power Annex, missions, NPC interactions, location presentation) and host the shared Inventory/Equipment drawers.
- **Feature-specific UI stays feature-owned:** `features/mining/MiningActivity.tsx`, `features/refining/RefiningConsole.tsx`, `features/travel/*`, `features/cargo/*`, etc. remain owned by their feature. Mining-specific concerns such as Salvage Cutter / Power Cell boosting and run-panel collapse behavior are not Play concerns.
- **Inventory/Equipment are shared surfaces:** global surfaces and generic helpers live under `features/inventory/` rather than `features/mining/`. The carried-inventory mutation boundary lives in `server/carried-inventory.ts`.
- **RNG ownership is activity-local:** activity RNG implementations remain activity-owned (Mining RNG, Refining E2E RNG), while Play owns the default wiring so generic callers no longer import Mining merely to obtain a random source.
- **Server-authoritative state/reconciliation is unchanged:** the generic extraction is an ownership refactor; the browser remains untrusted and all progression resolves server-side in the locked action transaction.

See `docs/gameplay-foundations.md` for timing/progression/inventory contracts and `docs/missions.md` for the declarative mission framework.

## Where minigames fit

Phaser experiences live in `minigames/`, isolated from the main React tree. They communicate through small typed contracts; any progression result is server-validated. They are not part of this foundation issue.

## Strict TypeScript & SSOT

- Strict TypeScript is enabled project-wide (`tsconfig.json`, `strict: true`, plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`).
- Single source of truth: every rule, identifier, content definition, and persistence shape has one home. Derived values are computed from authoritative inputs, not redundantly stored. See `AGENTS.md` and `docs/component-boundaries.md`.

## Current status

RuneSpace is a **playable pre-alpha** under active development. The generic Play shell is live and composes the connected early-game loop: Travel/Scavenging, Ferrite Shale Mining at The Jag, Refining at the Abandoned Processing Yard, Welding/Cargo Hold repair at Crash Site, Inventory/Equipment, locations and Power Cells/Power Annex, NPC interactions, and the declarative mission framework (Walk It Off / Cut Your Teeth / Waste Not). The architecture beyond this vertical slice — additional skills, quests, hex exploration, multiplayer, and minigames — remains scoped to future approved issues.
