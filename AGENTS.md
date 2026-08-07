# AGENTS.md — Read this before editing RuneSpace

RuneSpace can be developed with any capable coding harness. These rules keep the
codebase safe to modify and consistent with the architecture. **Read the relevant
`docs/` before editing, and re-read them when the change crosses a boundary.**

This is the repository's sole normative authority for agent behavior. See
`docs/development-workflow.md` for supporting procedure.

## Before you plan
- Read the docs that govern the area you are touching. Route by area:
  - Architecture, boundaries, single source of truth: `docs/architecture.md`,
    `docs/component-boundaries.md`.
  - Game rules, content, balance: `docs/game-rules.md`,
    `docs/gameplay-foundations.md`.
  - UI tokens, styling, or overlay motion: `docs/design-system.md`.
  - Authentication, trusted hosts/origins, cookies, or auth env:
    `docs/authentication.md`.
  - Tests and the canonical E2E runner: `docs/testing-strategy.md`. Choose the
    cheapest reliable test layer (unit → integration → E2E) per its ownership guide.
  - Branch/PR procedure, validation, observing CI/deploys:
    `docs/development-workflow.md`.
  - Coolify/database operations: `docs/deployment-database.md`.
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
6. **Validate proportionally.** During implementation, run focused checks for
   the touched boundary plus enough static validation to avoid pushing an
   obviously broken checkpoint. A coherent draft preview push is allowed before
   the complete local CI-parity sequence when real-device review is the goal;
   Coolify preview deployment remains independent of the expensive gate. Before
   marking a PR ready or requesting final review, run the complete local
   CI-parity sequence when the environment is available:
   `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
   `pnpm format:check`, `pnpm test`, `pnpm build`, integration tests, and
   `pnpm test:e2e:canonical`. Resolve failures or document genuine external
   blockers. After a correction to a ready PR, focused local evidence plus the
   required remote gate rerun is sufficient; do not blindly repeat the entire
   local suite after every small correction.
7. **One draft PR.** Create or update exactly one draft pull request for the issue.
   Work stops at a draft PR for human review. Do not merge unless the product
   owner explicitly instructs it to merge after review. Include the exact branch,
   PR, local validation results, canonical CI result, architectural decisions,
   review approach, limitations, and unresolved questions; for UI changes include
   the preview URL as the default visual evidence (frozen screenshots only when
   requested or the preview is unavailable). Include `closes #<issue number>` in
   the PR body: the closing keyword is a body reference that takes effect only
   when the PR is merged, and merging remains the product owner's explicit
   action — a branch name or PR title does not replace the body reference. Do not
   hand-maintain a commit SHA in the body — GitHub shows the head commit. State
   exactly whether gameplay, balance, persistence, or player-facing behavior
   changed and which approved decisions governed those changes.
8. **Follow every workflow that actually triggers.** Draft synchronization runs
   the fast checks and intentionally does not run the PostgreSQL or canonical
   jobs unless `full-ci` is present. Applying `full-ci`, marking the PR ready,
   pushing to a ready PR, pushing to `main`, or manually dispatching the workflow
   requests the full gate. Follow triggered jobs until every required job is green
   or a genuine external blocker is precisely documented — an in-progress run is
   not a pass. Poll actual state (`gh pr checks`, preview probe) at short,
   individually bounded intervals — never one long blind `sleep`. For a failed
   job, inspect the logs, repair on the same branch, push, and follow the
   replacement run. The required `Merge gate` is intentionally unsatisfied on
   draft-only checkpoints so skipped expensive jobs cannot satisfy branch
   protection; do not mistake that expected draft guard for an application
   regression. Treat optional improvements separately from blockers. Never begin
   another issue early.

## QC Failed status manifest upkeep

RuneSpace publishes a small, intentionally **public** status manifest at
`.qcfailed/status.json` (schema version one) so the live "Current Build Floor /
QC Operations Console" on qcfailed.com can show what RuneSpace is actively
working on. Supporting procedure lives in `docs/development-workflow.md`; this
section is the normative contract. The manifest must never contain secrets,
credentials, private account information, internal corporate information,
unpublished client work, or speculative claims.

### Schema-one field meanings
- `schemaVersion` — always `1`.
- `projectSlug` — the stable public slug, `runespace`.
- `workState` — `active`, `maintenance`, or `paused`; the manifest carries the
  current truthful value.
- `currentFocus` / `latestCompleted.summary` / `nextStep` — concise public-safe
  sentences, each no longer than 240 characters.
- `latestCompleted` / `highlights` / dates — real, non-future `YYYY-MM-DD`
  values; URLs are absolute public `https` URLs; `highlights` holds zero to
  three entries.
- `currentChange` — optional; only a meaningful product PR adds it.

### Meaningful-status upkeep
When a PR meaningfully changes RuneSpace's current focus, latest completed
milestone, next meaningful step, work state, or portfolio-worthy public
highlights, update `.qcfailed/status.json` in that same PR. Do not update it
for every commit, dependency bump, typo fix, CI-only change, test-only
correction, or other trivial maintenance. Keep status text public-safe,
factual, concise, and reviewable beside the work that caused it.

### Active-review upkeep
After opening a meaningful product pull request, add or update `currentChange`
on that PR branch with the actual PR number, and advance `stage` as work moves
through `implementation`, `review`, `preview`, and `merge-ready`. Do not copy a
preview URL into the manifest.

### Rollover after merge
When starting the next meaningful product PR, move the previously merged change
into `latestCompleted` when appropriate, update `currentFocus`, `nextStep`,
`lastMeaningfulUpdate`, and highlights truthfully, and replace `currentChange`
with the new active change only after the new PR exists. Never present a
closed-unmerged change as completed.

### Why the PR number is stored but the preview URL is not
`.qcfailed/status.json` stores only the PR number (via `currentChange`); it
never stores a preview URL. qcfailed.com derives preview URLs locally from the
PR number against its allowlisted template rather than trusting a remote URL.

### Verified RuneSpace preview pattern
RuneSpace's preview pattern is `https://pr-{pullRequestNumber}.runespace.qcfailed.com`.
The qcfailed.com project catalog owns the allowlisted template; do not add this
template to `.qcfailed/status.json`.

### Infrastructure-only work must not displace product milestones
Workflow hardening, dependency bumps, typo fixes, CI-only corrections,
test-only flakes, and other infrastructure-only maintenance must not add or
replace `currentChange`, and must not silently displace the latest public
product milestone in `latestCompleted`/`highlights`, unless Brandon explicitly
decides the work is portfolio-worthy.

### qcfailed.com responsibilities
qcfailed.com, not RuneSpace, remains responsible for remote validation, GitHub
PR-state interpretation, preview probing, fallback snapshots, and public
rendering. RuneSpace only keeps the committed manifest parseable and internally
consistent (see `tests/unit/qcfailed-status.test.ts`).

## Tooling reference
- pnpm is the package manager; the lockfile is committed and installs are frozen.
- Node 22 and pnpm 9.15.4 are pinned (see `package.json` `engines`/`packageManager`).
- Key scripts: `dev`, `build`, `start`, `lint`, `format`, `format:check`,
  `typecheck`, `test`, `test:integration`, `test:e2e`, `test:e2e:canonical`.
- `test:e2e` is a quick development command; `test:e2e:canonical` is the
  required CI-parity browser command that agents must use to validate E2E
  behavior (and frozen screenshots when requested via
  `RUNESPACE_E2E_SCREENSHOTS=true`).
- **Host Node note:** Some development hosts may have a user-local Node 24
  installation (e.g., at `~/.local/node-v24.18.0-linux-x64/bin/node`) that
  `.bashrc` prepends to `PATH` for interactive shells. Non-interactive shells
  (including this harness) do not source `.bashrc` and fall back to the system
  Node 22 at `/usr/bin/node`. Both versions coexist; do not uninstall either.
  Verify the active version with `node --version` before running validation.

### Host-local PostgreSQL
- On Brandon's managed RuneSpace host checkout, run database-backed and Node-22-bound
  commands through `./scripts/managed-host-run.sh`, which loads the private
  `/home/brandon/.config/runespace/dev.env`, forces the system Node 22 (never the
  user-local Node 24), and validates a localhost-only `DATABASE_URL` before executing
  the command. Do not `source` or print the private file manually.
- Never print, `cat`, `echo`, log, commit, or include the private file's contents in reports.
  Do not guess PostgreSQL credentials or substitute Docker Compose credentials from `.env.example`.
  Do not use `postgres://runespace:runespace@localhost:5432/runespace` on this managed host.
- If the private file is missing or unreadable, `managed-host-run.sh` refuses to start; stop and
  report the environment blocker rather than inventing fallback credentials. Database-backed
  commands include `pnpm drizzle-kit migrate`, `pnpm test:integration`, and
  `pnpm test:e2e:canonical`.
- The canonical runner's localhost safety check remains authoritative. Never access the Coolify
  production database for local testing.
- Managed-host command sequence (`managed-host-run.sh` verifies Node 22 and the localhost
  database itself):
  ```bash
  cd /home/brandon/workspace/projects/runespace
  ./scripts/managed-host-run.sh pnpm install --frozen-lockfile
  ./scripts/managed-host-run.sh pnpm typecheck
  ./scripts/managed-host-run.sh pnpm lint
  ./scripts/managed-host-run.sh pnpm format:check
  ./scripts/managed-host-run.sh pnpm test
  ./scripts/managed-host-run.sh pnpm drizzle-kit migrate
  ./scripts/managed-host-run.sh pnpm test:integration
  # Production build: `next build` runs as production, so server/env.ts requires a
  # BETTER_AUTH_SECRET of at least 16 characters. Scope a clearly fake build-only
  # placeholder to this one invocation only (matching .github/workflows/ci.yml).
  ./scripts/managed-host-run.sh env \
    BETTER_AUTH_SECRET="insecure-ci-build-only-secret-do-not-use-in-prod-0000000000" \
    pnpm build
  ./scripts/managed-host-run.sh pnpm test:e2e:canonical
  ```

### Managed-host ports and process cleanup
- Port `3000` belongs to OpenChamber. Never use it for RuneSpace work and never
  kill its process.
- Port `3200` belongs to the canonical RuneSpace E2E runner
  (`scripts/run-canonical-e2e.mjs`).
- An independent focused E2E run must use a separately confirmed-free high port,
  never `3000` or `3200`. `pnpm test:e2e:focused` defaults to `3310` and refuses
  to start unless that port is confirmed available.
- Do not manually assemble `next build` + `next start` for browser validation on
  the managed host. Use `pnpm test:e2e:focused <phase>`, `pnpm test:e2e:canonical`,
  or the deployed PR preview unless diagnosing the runner itself.
- Before cleaning up any listener, inspect the owning PID with `ss -tlnp` and
  kill only a positively identified RuneSpace-owned test-server PID with a
  targeted `kill <pid>`. Never use broad `pkill -f` or blanket Next.js
  cleanup.
