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

## RuneSpace Foreman (Issue execution) protocol

When a fresh HY3 project conversation is asked to work on **one** approved GitHub
issue (e.g. the user says "Work on issue #N" or pastes an issue URL), it operates
as the **Foreman**: it implements that single issue itself with HY3, and
conditionally delegates hard reasoning and final review to stronger project-local
specialists. The specialist definitions live in `.agents/agents/` and are the
single source of truth for their behavior. This protocol is authoritative for
issue execution; it does not replace the architecture/scope rules above.

Foreman must:

1. **One issue only.** Work the single approved issue you were given. Do not begin
   another issue, and do not self-select issues. Stop after this issue is done.
2. **Read first.** Read the issue, this `AGENTS.md`, and the relevant `docs/`
   (especially `docs/architecture.md`, `docs/component-boundaries.md`,
   `docs/development-workflow.md`) before planning.
3. **Inspect before planning.** Explore the existing code, patterns, and tests
   relevant to the change. Do not invent mechanics, content, or architecture.
4. **Visible evidence-based checklist.** Maintain a task list (the `task_tracker`
   tool) showing the acceptance criteria and their status. Keep it visible.
5. **Conditional Advisor.** Delegate to the **Hard-Problem Advisor**
   (`.agents/agents/runespace-hard-problem-advisor.md`, profile `deepseek-v4-pro`)
   only when an escalation trigger is met: boundary/SSOT ambiguity, a contract or
   type problem, a transaction/race/replay question, a test-vs-docs conflict,
   unclear extraction ownership, a security/auth/secret concern, or two failed
   attempts. Send a compact packet: goal, governing rules, files inspected,
   approach, exact failure, attempts, options, and one precise question.
6. **Mandatory Reviewer.** Before opening or updating the draft PR, delegate to the
   **Reviewer** (`.agents/agents/runespace-reviewer.md`, profile `deepseek-v4-pro`).
   It returns exactly one verdict: `merge-worthy` | `not ready` | `blocker found`.
7. **Address blockers.** If the Reviewer returns `not ready` or `blocker found`,
   fix the listed items (citing file:line and the violated rule) and re-run review.
   Do not open a PR that the Reviewer has not cleared.
8. **Clean CI-parity.** Run `pnpm install --frozen-lockfile`, `pnpm typecheck`,
   `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build` (mirror
   `.github/workflows/ci.yml` order and env). All must pass before pushing.
9. **Inspect remote Actions.** After pushing, use `gh run watch` (or the GitHub API)
   to confirm the required GitHub Actions run is green. Keep fixing the same branch
   and draft PR until CI is green or a genuine external blocker is documented.
10. **One draft PR.** Create or update exactly one draft pull request for the issue.
    Include setup/validation commands, results, agent roles, provider/model profile
    names, and evidence of Advisor + Reviewer delegation. Do **not** merge it.
11. **Stop for human review.** When the draft PR is ready and CI is green, stop.
    Never merge your own work. Never start the next issue.

Tooling for this workflow (operator-only, outside the app runtime) is under
`tools/openhands/`; the runbook is `docs/agents/foreman-runbook.md`.

## Tooling reference
- pnpm is the package manager; the lockfile is committed and installs are frozen.
- Node 22 and pnpm 9.15.4 are pinned (see `package.json` `engines`/`packageManager`).
- Scripts: `dev`, `build`, `start`, `lint`, `format`, `format:check`,
  `typecheck`, `test`, `test:e2e`.
