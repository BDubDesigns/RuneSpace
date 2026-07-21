# AGENTS.md — Read this before editing RuneSpace

RuneSpace can be developed with any capable coding harness. These rules keep the
codebase safe to modify and consistent with the architecture. **Read the relevant
`docs/` before editing, and re-read them when the change crosses a boundary.**

This is the repository's sole normative authority for agent behavior. See
`docs/development-workflow.md` for supporting procedure.

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
- Request product-owner approval before choosing unresolved gameplay values or
  visual direction.
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

## Issue execution workflow

When asked to work on one approved GitHub issue, the active model implements that
issue. This workflow is harness-neutral and does not require project-local
subagents or automation that may be unavailable.

1. **One issue only.** Work the single approved issue you were given. Do not begin
   another issue, and do not self-select issues. Stop after this issue is done.
2. **Start from current remote state.** Fetch the remote, then create one fresh
   branch from the latest `origin/main`, not an assumed local branch.
3. **Read and inspect first.** Read the issue, this `AGENTS.md`, the relevant
   `docs/`, code, tests, package scripts, and CI workflow before planning. Do
   not invent mechanics, content, lore, balance, architecture, or visual direction.
4. **Plan against evidence.** Keep a checklist of the issue acceptance criteria and
   their status using the harness's available task-tracking mechanism, if any.
5. **Seek a separate model pass when available.** For boundary or SSOT ambiguity,
   contracts, concurrency, security, test/documentation conflicts, two failed
   attempts, or substantial scope growth, ask a separate model to review the
   problem. Before a draft PR, request a separate-model final review when the
   harness supports it. Automated delegation being unavailable must not block
   ordinary work; perform and document a careful self-review instead. OpenCode
   users may switch models manually for either pass.
6. **Clean CI-parity.** Run `pnpm install --frozen-lockfile`, `pnpm typecheck`,
   `pnpm lint`, `pnpm format:check`, `pnpm test`, and `pnpm build`, mirroring
   `.github/workflows/ci.yml` environment requirements. Resolve failures or
   document genuine external blockers.
7. **One draft PR.** Create or update exactly one draft pull request for the issue.
   Work stops at a draft PR for human review. Do not merge unless the product
   owner explicitly instructs it to merge after review. Include the exact branch,
   commit, PR, local validation results, canonical CI result, required artifact
   evidence, architectural decisions, review approach, limitations, and unresolved
   questions. State exactly whether gameplay, balance, persistence, or
   player-facing behavior changed and which approved decisions governed those
   changes.
8. **Follow canonical CI through completion.** Remain active after pushing until
   canonical CI completes. For a failed run, inspect the actual failed job and
   step logs, repair relevant failures on the same branch, push, and wait for the
   replacement run. Stop only when CI is green or a genuine external blocker is
   precisely documented. Treat optional improvements separately from blockers.
   Never begin another issue early.

## Tooling reference
- pnpm is the package manager; the lockfile is committed and installs are frozen.
- Node 22 and pnpm 9.15.4 are pinned (see `package.json` `engines`/`packageManager`).
- Key scripts: `dev`, `build`, `start`, `lint`, `format`, `format:check`,
  `typecheck`, `test`, `test:integration`, `test:e2e`.
