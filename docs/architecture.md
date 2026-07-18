# Architecture

## Direction: modular monolith

RuneSpace starts as a **modular monolith**: one repository, one application, one
database, one deployment, with strong internal boundaries. There are **no**
microservices, no multi-repository layout, and no premature monorepo tooling.

The internal boundaries below are enforced by convention and directory layout,
not by separate deployables. When a boundary genuinely needs to scale
independently (background workers, isolated minigame runtimes), that is a later,
explicit decision.

## Server-authoritative game model

The browser is **never** the trusted source of progression. Future inventories,
XP, fuel, rewards, quest state, timers, and travel outcomes are resolved by
server-authoritative domain logic and persisted server-side. Clients send
intent; the server validates, resolves, and stores the result.

This means:

- Game rules live in `game/domain/` and are called from `server/`.
- React components never compute or store authoritative state.
- Any client-side value (a minigame score, a displayed timer) is treated as
  untrusted until re-validated by the server.

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
- `game/domain/` and `game/content/` are framework-free (no React, no Next.js,
  no `pg`). They are the pure core.
- `game/schemas/` depends only on Zod and the ID contract.
- `db/` depends on Drizzle, the schema in `db/schema.ts`, and `server/env.ts`.
- `minigames/` are isolated client-side boundaries; they talk to the app only
  through small typed contracts (no shared mutable game state).

Lower layers never import higher layers. Domain logic never imports UI.

## Player-intent flow

1. Player interacts in `app/` / `features/` (UI only).
2. UI calls a server action or route handler in `server/`.
3. `server/` authenticates (later), loads data via `db/`, and calls pure rules
   in `game/domain/`.
4. Domain rules resolve the outcome from authoritative inputs (content from
   `game/content/`, validated by `game/schemas/`).
5. `server/` persists the result through `db/`.
6. UI reflects the server-confirmed state.

## Where minigames fit

Phaser experiences live in `minigames/`, isolated from the main React tree. They
communicate through small typed contracts; any progression result is
server-validated. They are not part of this foundation issue.

## Strict TypeScript & SSOT

- Strict TypeScript is enabled project-wide (`tsconfig.json`, `strict: true`,
  plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`).
- Single source of truth: every rule, identifier, content definition, and
  persistence shape has one home. Derived values are computed from authoritative
  inputs, not redundantly stored. See `AGENTS.md` and
  `docs/component-boundaries.md`.

## Current status

This document describes the target architecture. The foundation scaffold
implements the boundaries and tooling but **no gameplay systems** yet. Real
domain rules, content, and persistence tables arrive in later issues.
