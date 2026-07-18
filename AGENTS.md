# AGENTS.md — Read this before editing RuneSpace

RuneSpace is developed with OpenHands agents. These rules keep the codebase safe
to modify and consistent with the architecture. **Read the relevant `docs/`
before editing, and re-read them when the change crosses a boundary.**

## Before you plan
- Read the docs that govern the area you are touching: `docs/architecture.md`,
  `docs/game-rules.md`, `docs/component-boundaries.md`, `docs/testing-strategy.md`,
  `docs/development-workflow.md`.
- Inspect existing code first. Search for an existing component, domain rule,
  schema, or helper before creating a new one.

## Scope discipline
- Work **only** the issue you are assigned. Do not begin another issue.
- **Never invent** game mechanics, balance values, content, lore, NPCs, quests,
  resources, or architecture without explicit approval. If the issue does not
  specify it, do not add it.
- Implement only the acceptance criteria of the issue. Do not perform unrelated
  cleanup or scope expansion.

## Architecture rules
- Keep **server-authoritative rules outside React components**. Game logic,
  XP, fuel, rewards, quest state, timers, and travel outcomes are resolved by
  domain code (`game/domain/`) and applied through `server/`. The browser is
  never the trusted source of progression.
- Preserve **single source of truth (SSOT)**: each rule, identifier, content
  definition, and persistence shape has one authoritative home. Do not duplicate
  config values, rules, or content inside UI components.
- Follow the boundary map in `docs/architecture.md` exactly:
  - `app/` — routes/layouts/pages, thin composition only
  - `components/` — reusable visual primitives only
  - `features/` — player-facing vertical features (composition + wiring)
  - `game/domain/` — pure rules, calculations, state transitions, IDs
  - `game/content/` — typed content definitions, referenced by stable IDs
  - `game/schemas/` — Zod validation for content and request boundaries
  - `server/` — orchestration, authorized commands, persistence, timers
  - `db/` — Drizzle schema, migrations, narrow persistence code
  - `minigames/` — isolated Phaser boundaries, typed contracts only

## Component & module extraction
- Search for an existing component/domain rule/schema before adding a new one.
- Extract a shared visual primitive when a **second real consumer** needs the
  same styling/behavior.
- Extract domain logic when a **second real feature** needs the same rule.
- Split a module when one file gains multiple distinct responsibilities.
- Avoid giant page components and feature god-objects.
- Avoid speculative universal abstractions based only on superficial similarity.
  Rule: _Build the smallest clear boundary needed now; generalize when a second
  real use case proves what is shared._

## Dependencies
- Add **no dependency** without a concrete, documented need. Prefer the existing
  stack (Next.js, React, Tailwind, Drizzle, pg, Zod, Vitest, Playwright, pnpm).
  If you must add one, note the justification in the PR and docs.

## Before completion
1. Run the required checks: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
   `pnpm test`, `pnpm build` (and `pnpm test:e2e` locally where possible).
2. Self-review the final diff for: duplication, missed component/module
   extraction, premature abstraction, game logic in UI, unjustified
   dependencies, and scope creep.
3. Open or update a **draft** pull request and **stop for human review**.
   - Include commands run, results, screenshots (mobile + desktop), key
     architectural decisions, and any unresolved questions.
   - Confirm no gameplay was implemented.
4. **Never merge your own work.**

## Tooling reference
- pnpm is the package manager; the lockfile is committed and installs are frozen.
- Node 22 and pnpm 9.15.4 are pinned (see `package.json` `engines`/`packageManager`).
- Scripts: `dev`, `build`, `start`, `lint`, `format`, `format:check`,
  `typecheck`, `test`, `test:e2e`.
