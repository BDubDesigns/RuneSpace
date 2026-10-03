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
  - Missions and NPC conversations: `docs/missions.md`,
    `docs/npc-conversations.md`.
  - Character canon, voice, relationships, and spoiler boundaries: the
    **Notion Canon**, RuneSpace's world/narrative source of truth.
    `docs/npc-canon.md` links to it and explains the Notion / shipped-code /
    GitHub Issue split. Canon is internal and spoiler-complete: read the
    relevant Canon page before writing any dialogue, Mission, Work Order,
    Update, or Wiki copy involving a named NPC, never copy from it into
    player-facing text, and never quote protected canon into this public
    repository. Without Notion access, stop and ask rather than inventing or
    reconstructing canon.
  - Work Order board rules, client eligibility, and the authored job pool:
    `docs/work-orders.md`. Work Orders shipped in #207, so that document now
    describes shipped behaviour; `docs/gameplay-foundations.md` owns the
    Welding, Clean Pass, and Workbench rules they share with Practice.
  - UI tokens and motion: `docs/design-system.md`.
  - Art generation, asset preparation, and visual QA: `docs/art-cookbook.md`.
  - Authentication and trusted hosts: `docs/authentication.md`.
  - Chat moderation, sanctions, appeals, and privileged-access audit:
    `docs/moderation.md`; the Community Rules and Safety & Privacy Wiki pages
    must stay true to shipped safety-data storage and access.
  - Tests and canonical E2E: `docs/testing-strategy.md`.
  - Branches, PRs, validation, and CI: `docs/development-workflow.md`.
  - Database and deployment operations: `docs/deployment-database.md`.
  - QC Studio exports: `docs/qc-studio.md`.
- Inspect existing components, rules, schemas, helpers, tests, scripts, and CI
  before creating anything new.

## Scope and pre-beta data compatibility

- Work **only** the assigned issue or approved bundle. Do not begin another
  issue, expand scope, or perform unrelated cleanup.
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

## Where things live

Grep for these before re-deriving them from scratch.

- **Dialogue content has a shadow copy in QC Studio.** `game/content/dialogue.ts`
  defines the authoritative `DialogueBeat` types and every authored beat.
  `tools/qc-studio/` keeps a parallel mirror for its authoring/preview tool:
  `core/types.ts` (beat type mirror), `core/validation.ts` (quantity/range
  validation mirror), `adapters/runespace/dialogue-adapter.ts` (converts real
  content into Studio's shape), and `modules/dialogue/DialogueStudio.tsx`
  (preview rendering, with its own `DialoguePreviewProps` mirroring
  `features/dialogue/DialogueScene.tsx` and `DialoguePlayer.tsx` props).
  Changing a beat's shape, an item beat's quantity rule, or a
  dialogue-rendering component's props needs the matching edit in QC Studio
  too, or `tests/unit/qc-studio-adapter.test.ts` fails. Item-beat quantity
  ranges specifically: `getItemBeatQuantityRange` in
  `game/content/item-presentation.ts` (derived from an item's `stackLimit`)
  is mirrored by `getStudioItemQuantityRange` in
  `tools/qc-studio/core/validation.ts`.

- **A named mechanic's display name fans out well past its component.** For
  example, "Clean Pass" appears in the docs, the Notion Canon, the public Wiki
  and Updates content (`features/public-site/`), feature components,
  `game/domain/`, `game/config/balance.ts`, and tests — two dozen files. When adding, renaming,
  or reworking a player-facing mechanic, `grep -rn "<exact display name>"`
  repo-wide before considering the change done; docs, public Wiki/Update
  content, and tests drift silently and none of them will type-error if
  missed.

- **A "success" visual language already exists — check before inventing
  one.** Completion/success visual treatment (color, glow, animation) is
  centralized in `app/globals.css` (`--rs-accent-success*` custom properties,
  `@keyframes rs-result-success`) and used by `components/ui/Feedback.tsx`,
  `components/ui/ActionButton.tsx`, `components/ui/MissionGuidanceHalo.tsx`,
  and feature-level examples like `features/welding/CleanPassControl.tsx`.
  Check these for the existing pattern before designing a new completion
  surface.

## Issue execution workflow

1. One coherent, bounded change per PR: one issue, or several the product
   owner explicitly bundled (`docs/development-workflow.md`). Then stop.
2. Fetch the remote and create one fresh branch from the latest `origin/main`,
   not an assumed local branch. On a shared host use your own git
   worktree and `issue-<n>` database key; never edit another agent's worktree or
   depend on an unmerged sibling branch.
3. Read the issue, this file, relevant docs, code, tests, package scripts, and
   CI workflow before planning. Do not invent unspecified behavior.
4. Track acceptance criteria against evidence. For boundary, SSOT, concurrency,
   security, test/documentation conflicts, or two failed attempts, seek a
   separate model review when available; otherwise self-review carefully.
5. Validate proportionally with focused local checks: unit, integration, or a
   targeted E2E spec according to the ownership guide. The PR's automatic CI
   runs the full canonical suite, so do not duplicate it locally as routine;
   run it locally to reproduce or diagnose a failure, or for a genuinely
   high-risk boundary change. Zero retries and deterministic fixtures are part
   of the proof, not problems to hide with sleeps or retries. On the shared
   Hermes host, both local E2E runners queue on one host-wide lock (see
   `docs/development-workflow.md`).
6. Use `./scripts/managed-host-run.sh` for managed-host and Node-22-bound
   commands. On Hermes, every DB-backed command must run through
   `scripts/runespace-db.mjs` after creating a validated disposable database.
   Report any check you could not run as unexecuted.
7. Open or update exactly one PR after the final self-review and focused
   validation pass. Open a normal PR by default; Draft only marks genuinely
   unfinished work and changes no CI. Include `closes #<n>` per finished issue,
   branch and PR identity, local and remote validation, architectural decisions,
   limitations, unresolved questions, and whether gameplay, persistence, or
   player-facing behavior changed. Stop for human review; do not merge without
   explicit product-owner instruction.
8. Every PR push runs full CI: fast checks, PostgreSQL integration, and three
   canonical E2E shards start together, and `Merge gate` passes only when all
   succeed. Follow the run to a terminal state; inspect failed logs, repair on
   the same branch, push, and follow the replacement run. The handoff ends at
   the PR, its observed checks, and owner review.

Issue and PR state are authoritative. Agents do not move GitHub Project board
cards; the board is an optional owner tool.

A merged PR or archived session does not remove its worktree, and neither proves
it is disposable. Keep an issue's worktree while its PR is open. Remove a
finished one only with Brandon's explicit authorization and the verification in
`docs/development-workflow.md` ("Retiring a merged issue's worktree"); otherwise
list candidates and continue. Never remove a primary, current, locked, dirty,
untracked, or unverified worktree, and never use `rm -rf`,
`git worktree remove --force`, or `git clean`.

## QC Failed status manifest

`.qcfailed/status.json` is intentionally public and is still read by
qcfailed.com's Build Floor until qcfailed.com issue #22 migrates that consumer;
it is retired afterward. Do not make routine or status-only manifest updates.
Edit it only when an issue or Brandon asks, and keep it valid
(`tests/unit/qcfailed-status.test.ts` enforces the schema) and free of secrets,
credentials, private account information, internal corporate information,
unpublished client work, or speculation.

## Public Updates

For meaningful player-facing gameplay, UX, balance, content, or progression
changes, decide whether a public Update is warranted. When it is, add one
following the authoring procedure in `docs/public-updates.md` in the same PR
unless the issue says otherwise.
Do not add Updates for internal-only work without meaningful player impact, or
rewrite a published Update for unrelated later changes; an issue's explicit
Update requirement is authoritative.

## Player Wiki

When a gameplay, content, UX, balance, or progression change materially
changes a fact already documented in the public Wiki, update the affected
Wiki page(s) in the same PR following `docs/public-wiki.md`, unless the issue
says otherwise. Add a new Wiki page only when new player-facing information
does not fit cleanly into an existing page; otherwise update the most
relevant existing page(s) — never a blanket "new feature = new page" rule,
and never one thin page per new item, action, or mechanic. One narrow
exception: a named recurring character in the NPC roster gets its own page,
written only from the Public-Wiki-safe facts on that character's Notion Canon
page (see `docs/public-wiki.md`, "Named-character pages"). Internal-only
CI/test/refactor/architecture work does not require a Wiki edit unless it
changes actual player-visible behavior. Never publish approved-but-unshipped
design as current Wiki behavior.

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
  and review procedure. Do not access production or remove
  broad services, volumes, networks, credentials, or data without explicit
  approval.
