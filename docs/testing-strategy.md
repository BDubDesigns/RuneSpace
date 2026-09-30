# Testing Strategy

RuneSpace uses a **risk-based** testing strategy. Tests focus on where bugs and
exploits are most costly: pure domain rules, server/persistence boundaries, and a
small number of critical mobile player journeys.

## 1. Unit tests (Vitest)
- Target: **pure domain rules** in `game/domain/` — calculations, state
  transitions, and validation contracts in `game/schemas/`.
- Environment: `node` (no DOM needed for pure logic).
- Must be fast, deterministic, and free of network/DB.
- Foundational timing, inventory, and progression rules have focused unit
  coverage alongside the content-ID contract.
- Run: `pnpm test`.

## 2. Integration tests
- Target: **server/persistence boundaries** — command handlers in `server/`,
  Drizzle queries in `db/`, and end-to-end resolution of player intent against a
  real (or test) database.
- These assert that domain outcomes are actually persisted and that the server
  is the authority. Ownership and gameplay-foundation tests run against the
  PostgreSQL service in the dedicated CI job and via `pnpm test:integration`.

## 3. Browser tests (Playwright)
- Target: a **small number** of important mobile player journeys (the smoke
  screen, then core loops as they ship). Avoid large suites of shallow UI tests.
- The landing page has a minimal app-loading smoke test
  (`tests/e2e/smoke.spec.ts`) that protects durable landing identity and entry navigation.
- Playwright source is type-checked before it is ever run. Every committed
  `.ts` file under `tests/e2e/**` (specs and helpers) is part of the one strict
  `tsconfig.json` program (issue #212), so a stale import, renamed export, or
  impossible type fails `pnpm typecheck`, and therefore the always-on
  `fast-checks` CI job, before any PostgreSQL, build, or browser work. There is
  no separate E2E typecheck command, and E2E files must not be excluded from
  `tsconfig.json` or silenced with `any` or `@ts-nocheck`. This is a static
  check only: it says nothing about browser behavior, which only the focused and
  canonical Playwright runs prove.
- Quick local development: `pnpm test:e2e`. It uses the production server by
  default and may reuse an existing server outside CI; set
  `PLAYWRIGHT_DEV_SERVER=true` for a development server. It does **not** count
  as CI-parity validation. On the managed RuneSpace host, plain `pnpm test:e2e`
  does not take the host-wide E2E lock (#251) and defaults to port `3000`, so do
  not run it on a managed host or on Hermes at all — use
  `pnpm test:e2e:focused <phase>` for managed-host iteration instead.
- The canonical CI-parity command: `pnpm test:e2e:canonical`. This is the single
  source of truth for local and CI behavioral verification. Its canonical
  selection is an explicit allowlist of behavioral specs — `canonicalSpecPattern`
  in `playwright.config.ts` is its single source of truth — covering Mining,
  Inventory Equip, Overlay, Character, Walk It Off, Cut Your Teeth, Travel,
  Location Population, Character Profile, Character Portraits, Refining, Bounded
  Runs, Cargo Hold, Deep Jag, Fabrication (Tier 1, and Fabrication 5 and 8 with the Loadsteel
  Cutter, the Freight Harness and their Missions — #233), Holo Hollow, Rusk Recovery, Admin Operator, Sign-out,
  Account News, Account Verification, Gameplay Access, and the Chat/Social shell and
  realtime stream (`social-shell`, #245). It intentionally excludes noncanonical `smoke`, `ownership`,
  `design-system`, `work-orders`, `public-*`, and QC Studio specs. It:
  - requires Node 22.x
  - requires a localhost-only disposable PostgreSQL database (refuses remote)
  - selects a dedicated test port
  - removes stale Playwright output and creates run-scoped worker state paths
  - runs committed migrations
  - runs one production build and starts one long-lived production server, then
    invokes Playwright once with the canonical allowlist and Chromium project
  - authenticates once per Playwright worker and creates a fresh authoritative
    test character for each test; special registration, character-creation,
    portrait, ownership, admin, sign-out, and account-news journeys keep their
    own contracts
  - the Power Annex journey uses a disposable runner-only clock file, gated to
    CI against localhost PostgreSQL, to cross a Pacific reset boundary without
    depending on the host wall clock
  - runs with zero retries, `trace: "retain-on-failure"`, and a timing reporter
    that prints total wall-clock time and the ten slowest tests; the admin
    operator suite is an intentional serial exception for its fixed allowlist
    and identity, and the gameplay-access suite (issue #223) is the other: it
    is the only spec that changes the global public-gameplay row, so it runs
    serially in the chromium project only and restores Closed after every
    journey, while every other fixture account carries fixture Early Access
  - on failure, Playwright's `screenshot: "only-on-failure"` and
    `trace: "retain-on-failure"` write per-test screenshots and traces into
    `test-results/`; CI uploads those as a bounded failure-diagnostics artifact
    regardless of screenshot review
  - runs as three independent GitHub Actions shards, each with its own
    PostgreSQL service, disposable database, migrations, production server, and
    shard-named diagnostics/timing artifacts; all three are required by Full
    and Merge gates
  - captures the curated review manifest only in a separate deterministic,
    unsharded one-worker job when `RUNESPACE_E2E_SCREENSHOTS=true` is explicitly
    requested through the `e2e-screenshots` label. The ordinary behavioral
    shards perform no curated screenshot I/O. The screenshot lane uses the same
    canonical selection and fixture contracts, verifies every expected file,
    and uploads `artifacts/e2e-review/`.
  - `test-results/` belongs to an individual Playwright invocation and may be
    cleaned or replaced by a later invocation (the focused runner does exactly
    that). Failure diagnostics are bounded to failing tests. Curated screenshots
    are produced only by the separate screenshot lane, which copies and
    verifies them under `artifacts/e2e-review/`; expected behavioral-shard
    cleanup is not lost output.
  - sets `RUNESPACE_E2E_CANONICAL_HTTP=true`, which disables Better Auth `Secure`
    cookies for the local production E2E runners (canonical and focused) only.
    Production-mode Better Auth issues `Secure`
    cookies that a plain-HTTP test origin (`http://127.0.0.1:<port>`) discards,
    dropping the session after sign-up; this gate is a test-runner-only exception
    (see `docs/authentication.md`). It applies only to the plain-HTTP loopback
    server those runners own, including canonical execution in GitHub Actions;
    it is never set for the ordinary CI build job, for previews, or for
    production.
- Every local E2E server also receives the account-boundary settings from
  `accountBoundaryE2eEnv` in `scripts/e2e-shared.mjs` (issue #221): test-only
  Turnstile keys, Turnstile site verification redirected to the server's own
  gated loopback stub (`app/api/e2e/turnstile-siteverify`, a 404 outside the
  local-E2E gate), and a run-scoped `RUNESPACE_E2E_MAIL_OUTBOX_FILE` that
  captures verification email. Registration journeys serve a local Turnstile
  stand-in script, give each journey its own client address through
  `X-Forwarded-For`, and follow the exact emailed link
  (`tests/e2e/account-helpers.ts`); no browser test calls Cloudflare or
  ZeptoMail. Specs that only need a signed-in player keep using
  `establishAuthenticatedSession`, which creates an explicitly verified
  account with a fixture Player name.
- Database isolation is automatic for the supported test entry points. The
  `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:e2e:focused`, and
  `pnpm test:e2e:canonical` commands derive a uniquely named local disposable
  database from the configured PostgreSQL server, apply migrations there, run
  the command, and force-drop that database in cleanup. They never use the
  persistent development database for fixtures. The `*:raw` scripts are
  internal runner targets and refuse to run unless the disposable database
  marker matches the selected database name.
- Agents may not report browser or CI parity as passing unless the canonical
  command actually passed. When a change adds or touches E2E specs, run the
  new/targeted spec(s) first in isolation and **then** the full
  `pnpm test:e2e:canonical` suite — `fast-checks` (typecheck/lint/unit/build)
  intentionally skips PostgreSQL integration and canonical E2E, so a green fast
  run is not evidence the merge gate will pass. For details see
  `AGENTS.md` §6 and `docs/development-workflow.md` (§Focused implementation
  checks, then full canonical parity).
- The canonical command is expensive by design: one invocation performs one
  full production `next build`, one `next start`, and the complete allowlisted
  selection, so it spans several minutes. For focused local iteration, run the
  affected spec (`pnpm test:e2e <spec> --project=chromium` on an unmanaged
  machine; on a managed host use `pnpm test:e2e:focused <phase>`).
  Ordinary `pnpm test:e2e` owns its server: it uses production build/start by
  default, or a development server when `PLAYWRIGHT_DEV_SERVER=true` is set.
  Focused evidence is never a substitute for the canonical command — only
  `pnpm test:e2e:canonical` and the matching CI job establish CI parity.
- Managed-host focused iteration uses `pnpm test:e2e:focused <phase>` (currently
  `mining`, `character-profile`, `location-population`, `character-portraits`,
  `cargo-hold`, `inventory-equip`, `travel`, `walk-it-off`, `cut-your-teeth`,
  `refining`, `bounded-runs`, `rusk-recovery`, `fabrication` (which also selects
  `fabrication-advanced.spec.ts`), `work-orders`, `gameplay-access`, and `account-verification`; recipe
  in `docs/development-workflow.md`). The focused runner
  reuses the canonical primitives from `scripts/e2e-shared.mjs` (localhost-only
  database safety, Node 22 validation, port availability, targeted process
  termination, and the host-wide lock that runs one local E2E lifecycle at a
  time across worktrees) and owns a separate high port (default `3310`, never `3000` or
  `3200`), a local build-and-runtime auth placeholder, and a small lifecycle:
  per-invocation output cleanup, migrations, one production build and server, the
  selected phase, then deterministic teardown of only its own processes.
  Focused results are iteration evidence only; only `pnpm test:e2e:canonical`
  and the matching CI job establish CI parity.
- GitHub Actions remains the final authority; canonical execution must use the
  same `pnpm test:e2e:canonical` command.

### Issue #145 surface coverage

The dedicated Play-surface change has focused coverage for the boundaries that
cannot be proven by server tests alone:

- `tests/unit/journey-feed.test.ts` proves that Journey feed entries derive
  presentation from the authoritative Travel/Scavenge projection without
  owning commands or persistence.
- `tests/unit/map-destination.test.ts` and the Mission edge-cue cases in
  `tests/unit/local-map-scroll-affordances.test.ts` (#240) prove the Map's
  selected-destination state and off-screen Mission cues are projections of
  existing adjacency, location-state, and Mission-guidance facts; the browser
  behaviour (sticky panel, dismissal, Details, arrow geometry, cues, newest-first
  Journey) is proven in `tests/e2e/travel.spec.ts`.
- Location Population and Character Profile E2E coverage proves that
  same-location browsing remains on Location and is absent from Map; the
  stationary Long Scramble composition has scene/description/population and no
  activity placeholder.
- Travel E2E coverage opens Map during an active Travel, keeps the Map URL
  mounted through authoritative arrival, and proves route/transit treatment
  clears, Back changes to Location, and stationary Map interaction is restored.
- Overlay and Inventory/Equipment E2E coverage proves the four footer
  destinations and the shared tabbed overlay while retaining existing
  server-confirmed loadout and inventory behavior. Mission equipment guidance
  also proves the shared Play entry point can open Equipment directly.

These tests use the existing narrow authoritative character/state fixtures;
they do not reconstruct a full early-game progression solely to reach a UI
surface. The final CI-parity sequence follows `docs/development-workflow.md`:
run the normal committed migration check (`pnpm drizzle-kit migrate`) when the
managed disposable database is available, then typecheck, lint, format check,
unit tests, `pnpm test:integration`, build, focused E2E, and the full
`pnpm test:e2e:canonical` run, which runs on GitHub when working from the shared
Hermes host.

- Uploading an artifact is not proof that promised evidence exists. Verify each
  expected evidence file before upload, and inspect artifact contents whenever
  evidence is part of the definition of done.

### Issue #245 realtime/social coverage

- `tests/unit/realtime.test.ts` owns the wire format and incremental parser,
  audience matching and in-process fanout, the publisher's independence from
  chat/trading models, the browser connection lifecycle (reconcile on connect
  and reconnect, immediate reconnect after a deliberate close, backoff,
  watchdog, refusal stops), duplicate-safe shell state, and the launcher's
  accessible attention state.
- `tests/integration/realtime.test.ts` proves stream authorization against
  PostgreSQL: unauthenticated, foreign-character, and gameplay-access refusals
  (including revocation between streams), the server-derived scope, delivery
  only to matching streams across several tabs, heartbeat, and the bounded
  lifetime.
- `tests/e2e/social-shell.spec.ts` proves, at phone and desktop widths, the
  floating launcher's placement and clearance, the Drawer over the current
  surface, reconnect after the deliberate close, one stream per tab across
  several tabs, and recovery of a suspended, offline tab. It ends streams
  through the local-E2E-only `POST /api/e2e/realtime` hook instead of waiting
  out the 5-minute lifetime.

## What to test when systems arrive
For progression-sensitive systems, prioritize:
- **exploit-sensitive transitions** (e.g., granting rewards)
- **resource consumption** (fuel, materials)
- **replay / duplicate-claim prevention** (idempotent commands)
- **persistence correctness** (the stored state matches the resolved outcome)

## Choosing the cheapest reliable layer (ownership guide)

Every important behavior needs one **primary proof at the cheapest reliable
layer**. Higher layers add smoke coverage only where the higher layer itself is
part of the contract. Do not prove every requirement at every layer.

Decide top-down:

1. **Can the behavior be proven without PostgreSQL and without a browser?**
   Prove it in `tests/unit/`. Examples from the current suite:
   - pure formulas and balance derivation — `mining.test.ts`, `gameplay-foundations.test.ts`
   - deterministic domain transitions and cursor math — `gameplay-foundations.test.ts`
   - inventory planning and capacity rules — `planStackAddition`, `planExactStackAddition`
   - command-gate/scheduler model behavior — `command-gate.test.ts`
   - timing, IDs, validation schemas, route-progress geometry — `travel.test.ts`,
     `ids.test.ts`, `route-progress.test.ts`, `local-map-layout.test.ts`

2. **Is persistence, concurrency, or ownership the point of the behavior?**
   Prove it in `tests/integration/` against real PostgreSQL. The browser cannot
   prove that a durable cursor, charge, claim, or reward was committed exactly
   once. Examples: transaction rollback, row-lock serialization, constraint and
   migration behavior, ownership boundaries, atomic multi-row gameplay commands
   (`gameplay-foundations.test.ts`, `travel.test.ts`, `power-annex.test.ts`,
   `power-cell-boost.test.ts`).

3. **Is the browser itself part of the contract?**
   Prove it in `tests/e2e/`. Keep the journey representative rather than
   exhaustive. Examples: automatic Mining/Travel boundary reconciliation
   (browser timers), overlay focus/scroll-lock/keyboard behavior, accessible
   names and announcements, responsive mobile layout, and rendering integration
   that cannot be trusted from unit or database tests alone. E2E should **not**
   re-prove every server formula, persistence branch, or edge case already
   covered below it.

When a behavior already has a primary proof at a cheaper layer, higher-layer
tests assert only the *layer-specific* outcome:
- a unit test proves boosted Mining timing and charge math;
- the integration test proves charge/XP/cursor commit and rollback as one unit;
- the E2E test proves the boosted-timer boundary reconciles automatically in the
  browser — it does not re-derive the timing table.

Only keep visual assertions that encode an approved durable layout/accessibility
contract or protect a demonstrated regression. Do not assert exact token colors
or pixel values (the `--rs-*` tokens in `app/globals.css` are the single source
of truth); do assert that a layer actually paints (never a dropped-transparent
layer) where that regression class is documented.

Before adding a new test, search the layer below it: if the behavior is already
proved there, prefer strengthening that proof or moving the assertion down.
Before removing or weakening a test, record where the behavior remains protected.

## Avoid
- Test duplication across layers.
- Excessive shallow component tests that assert markup without behavior.
- Testing implementation details instead of observable outcomes.
- Rewriting server state from the test process (for example moving an
  `active_actions` cursor back to fast-forward a timer) straight after a click.
  The click does not wait for its server command, so the write can land first,
  match nothing, and leave the test passing or failing on wall-clock timing
  (#243). Wait for a state only the committed command can render (such as
  `Stop Mining`) first, and make a fast-forward helper fail when it moves no
  row.

## CI scope and event matrix

The `CI` workflow always runs the fast job (frozen install, typecheck of the app
and every test including `tests/e2e`, lint, format check, unit tests, and one
production build) for PR revisions and pushes
to `main`. PostgreSQL integration and canonical E2E are selected by the explicit
full-gate policy and start only after the fast job succeeds, so a typecheck, lint,
unit, or build failure (including in `tests/e2e`) never spends integration or
browser minutes:

| Event | Fast checks | PostgreSQL + canonical E2E | Merge gate |
| --- | --- | --- | --- |
| Draft PR opened, reopened, or pushed | Yes | No | Intentionally unsatisfied |
| `full-ci` applied to a draft | Yes | Yes | Intentionally unsatisfied |
| Push while `full-ci` remains applied | Yes | Yes | Intentionally unsatisfied while draft |
| Draft converted to ready | Yes | Yes, without a code push | Required |
| Push to a ready PR | Yes | Yes | Required |
| Push to `main` | Yes | Yes | Required |
| Manual `workflow_dispatch` (`--ref <branch>` plus the `ref` input) | Yes | Yes | Required |

Labels on ready PRs request the full gate; adding `e2e-screenshots` also runs the
separate deterministic screenshot lane without adding its output to behavioral
shards. PR runs use a per-PR concurrency group so obsolete work is canceled only
for that PR; main and manual runs use unique groups. The static `Merge gate` is required and
intentionally fails on draft checkpoints. This is necessary because GitHub
marks a skipped required job successful; a green draft decision would otherwise
be reusable when the PR becomes ready without a new commit. Require only the
fast check and `Merge gate` in the `main` branch protection/ruleset; this
repository currently has no such protection configured — API-verified for
Issue #61 on 2026-08-03 (the GitHub REST branch-protection endpoint returns
`Branch not protected`, and the repository rulesets list is empty) — so a
maintainer must verify those settings separately. Treat that snapshot as dated
repository state and re-verify before acting on it.

CI retains a separate PostgreSQL integration job, a three-shard canonical E2E
matrix, and an opt-in unsharded screenshot lane. The canonical runner is the
single source of truth for E2E behavioral verification in both local development
and GitHub Actions; curated screenshots are produced and uploaded only in the
explicit screenshot lane (see §3), and per-failure diagnostics are always
retained with shard-specific artifact names.
