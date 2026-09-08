# AGENTS.md — Read this before editing RuneSpace

RuneSpace can be developed with any capable coding harness. These rules keep the
codebase safe to modify and consistent with the architecture. **Read the
relevant `docs/` before editing, and re-read them when the change crosses a
boundary.** This file is the repository's normative agent-behavior contract;
`docs/development-workflow.md` provides supporting procedure.

## Before you plan

- Read the docs that govern the area you are touching:
  - Architecture and boundaries: `docs/architecture.md`,
    `docs/component-boundaries.md`.
  - Game rules and content: `docs/game-rules.md`,
    `docs/gameplay-foundations.md`.
  - UI tokens and motion: `docs/design-system.md`.
  - Authentication and trusted hosts: `docs/authentication.md`.
  - Tests and canonical E2E: `docs/testing-strategy.md`.
  - Branches, PRs, validation, and CI: `docs/development-workflow.md`.
  - Database and deployment operations: `docs/deployment-database.md`.
  - QC Studio exports: `docs/qc-studio.md`.
- Inspect existing components, rules, schemas, helpers, tests, scripts, and CI
  before creating anything new.

## Scope and pre-beta data compatibility

- Work **only** the assigned issue. Do not begin another issue, expand scope,
  or perform unrelated cleanup.
- Never invent game mechanics, balance, content, lore, NPCs, quests, resources,
  architecture, or visual direction. Obtain product-owner approval for
  unresolved gameplay or visual choices.
- RuneSpace is pre-beta. Do not add permanent runtime compatibility for
  obsolete pre-release state belonging to a small dev/test cohort unless Brandon
  explicitly requires it. Prefer one explicit, narrow, idempotent migration,
  backfill, or maintenance repair instead.
- A one-time repair should identify its exact cohort, preserve invariants, and
  provide a dry-run or reviewed report where practical. Document the reason,
  inputs, safety checks, and retirement path, keep the operation outside normal
  runtime request/login flow, and remove or retire it after use. A repository-
  owned maintenance script is preferred when it materially improves review,
  safety, or repeatability; reviewed direct SQL is acceptable for a tiny,
  known repair.
- Avoid permanent legacy runtime branches, old-state detection on every request,
  alternate NPC or Mission paths, dual persistence, hidden flags, fallback
  reads, or login-time repairs for obsolete pre-release state. Distinguish a
  one-time data repair from a normal committed Drizzle/schema migration; see
  `docs/deployment-database.md`. Revisit this policy before beta or public
  player-data commitments.
- For an approved QC Studio export, read `docs/qc-studio.md`, resolve it against
  the current authoritative repository state, preserve native RuneSpace
  representation, and do not infer unrelated gameplay changes.

## Architecture rules

- Keep server-authoritative rules outside React. Game logic, XP, fuel, rewards,
  quest state, timers, and travel outcomes belong in `game/domain/` and
  `server/`; the browser is never the trusted source of progression.
- Preserve single source of truth: each rule, identifier, content definition,
  and persistence shape has one authoritative home. Do not duplicate config or
  rules in UI components.
- Follow the boundary map in `docs/architecture.md`:
  - `app/` — routes, layouts, pages; thin composition only
  - `components/` — reusable visual primitives
  - `features/` — player-facing vertical features and wiring
  - `game/domain/` — pure rules, calculations, transitions, and IDs
  - `game/content/` — typed content definitions referenced by stable IDs
  - `game/schemas/` — Zod content and request boundaries
  - `server/` — orchestration, authorized commands, persistence, timers
  - `db/` — Drizzle schema, migrations, narrow persistence code
  - `minigames/` — isolated Phaser boundaries with typed contracts

## Component, module, and dependency discipline

- Search for an existing component, domain rule, schema, or helper first.
- Extract a shared visual primitive or domain rule only when a second real
  consumer proves the boundary. Split modules when responsibilities diverge;
  avoid god objects and speculative universal abstractions.
- Add no dependency without a concrete documented need. Prefer the existing
  Next.js, React, Tailwind, Drizzle, pg, Zod, Vitest, and Playwright stack.

## Issue execution workflow

1. Implement one approved issue only and stop after that issue is done.
2. Fetch the remote and create one fresh branch from the latest `origin/main`,
   not an assumed local branch.
3. Read the issue, this file, relevant docs, code, tests, package scripts, and
   CI workflow before planning. Do not invent unspecified behavior.
4. Track acceptance criteria against evidence. For boundary, SSOT, concurrency,
   security, test/documentation conflicts, or two failed attempts, seek a
   separate model review when available; otherwise self-review carefully.
5. Validate proportionally. Use unit, integration, or E2E according to the
   ownership guide. If E2E specs change, run the targeted spec first and then
   `pnpm test:e2e:canonical`; zero retries and deterministic fixtures are part
   of the proof, not problems to hide with sleeps or retries.
6. Use `./scripts/managed-host-run.sh` for managed-host and Node-22-bound
   commands. On Hermes, every DB-backed command must run through
   `scripts/runespace-db.mjs` after creating a validated disposable database.
   Run the full local CI-parity sequence before marking a PR ready when the
   environment is available; report unavailable checks as unexecuted.
7. Open or update exactly one Draft PR. Include `closes #<issue>`, branch and
   PR identity, local and remote validation, architectural decisions,
   limitations, unresolved questions, and whether gameplay, persistence, or
   player-facing behavior changed. Stop for human review; do not merge without
   explicit product-owner instruction.
8. Follow triggered workflows to terminal state. Draft PRs intentionally skip
   PostgreSQL/canonical jobs unless `full-ci` is applied, and the draft-only
   Merge gate is expected to remain unsatisfied. Inspect failed logs, repair on
   the same branch, push, and follow replacement runs.

## QC Failed status manifest

RuneSpace publishes the intentionally public `.qcfailed/status.json`; it must
never contain secrets, credentials, private account information, internal
corporate information, unpublished client work, or speculation. It is schema
version `1`, uses project slug `runespace`, and restricts `workState` to
`active`, `maintenance`, or `paused`. Status sentences are factual and at
most 240 characters; dates are real non-future `YYYY-MM-DD` values; URLs are
absolute public HTTPS URLs; `highlights` has zero to three entries.

- Update the manifest in the same PR only when a meaningful product PR changes
  current focus, the latest completed milestone, next step, work state, or
  public highlights. Infrastructure-only, dependency, typo, CI-only, and
  test-only work must not displace product milestones.
- A meaningful product PR may add `currentChange` with the actual PR number and
  stage (`implementation`, `review`, `preview`, or `merge-ready`) after
  the PR exists. Never store a preview URL in the manifest; qcfailed.com
  derives it.
- On the next meaningful product PR, roll the prior merged change into
  `latestCompleted` when appropriate. Never present a closed-unmerged change
  as completed. qcfailed.com owns remote validation, PR interpretation, preview
  probing, and public rendering; RuneSpace only maintains the manifest contract.

## Public Updates

For meaningful player-facing gameplay, UX, balance, content, or progression
changes, decide whether a public Update is warranted. When it is, add one
through `docs/public-updates.md` in the same PR unless the issue says otherwise.
Do not add Updates for internal-only work without meaningful player impact, or
rewrite a published Update for unrelated later changes; an issue's explicit
Update requirement is authoritative.

## Tooling and safety reminders

- pnpm is the package manager; Node 22 and pnpm 9.15.4 are pinned. Key checks
  are `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, and
  `pnpm build`. `pnpm test:integration` and E2E entry points use disposable
  databases; their `*:raw` variants are internal and must not target
  development data.
- On managed hosts, the wrapper validates a localhost-only `DATABASE_URL` and
  loads private environment data without exposing it. Never print, source, log,
  commit, or guess credentials; never use the Coolify production database for
  local testing.
- Hermes uses approved `issue-<positive-number>` or `scratch` database keys
  through `scripts/runespace-db.mjs`; create, run, and drop only the validated
  disposable target. On the managed host, port 3000 belongs to OpenChamber,
  canonical E2E uses 3200, focused E2E uses a confirmed-free high port such as
  3310, and cleanup must target only a positively identified RuneSpace PID.
- Read `docs/development-workflow.md` for exact managed-host, CI, preview,
  status-manifest, and review procedure. Do not access production or remove
  broad services, volumes, networks, credentials, or data without explicit
  approval.
