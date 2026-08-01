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
- The scaffold includes a minimal app-loading smoke test
  (`tests/e2e/smoke.spec.ts`).
- Quick local development: `pnpm test:e2e`. It uses the production server by
  default and may reuse an existing server outside CI; set
  `PLAYWRIGHT_DEV_SERVER=true` for a development server. It does **not** count
  as CI-parity validation.
- The canonical CI-parity command: `pnpm test:e2e:canonical`. This is the single
  source of truth for local and CI behavioral verification, and for
  frozen-screenshot verification when screenshots are requested. It:
  - requires Node 22.x
  - requires a localhost-only disposable PostgreSQL database (refuses remote)
  - selects a dedicated test port
  - removes stale authentication and test state
  - runs committed migrations
  - runs one production build and starts one long-lived production server; all
    canonical phases reuse that server and teardown is deterministic on success,
    failure, timeout, or signal
  - runs the Mining Chromium journey
  - runs the Overlay Chromium journey (modal-overlay behavior shared by Inventory/Equipment)
  - runs the Travel Chromium journey
  - the Power Annex journey uses a disposable runner-only clock file, gated to
    CI against localhost PostgreSQL, to cross a Pacific reset boundary without
    depending on the host wall clock
  - runs the repeated Mining play-boundary check
  - captures frozen review screenshots into `artifacts/e2e-review/` **only when
    requested** via `RUNESPACE_E2E_SCREENSHOTS=true` (the CI workflow sets this
    from the `e2e-screenshots` PR label); in that mode it verifies the complete
    manifest (exists, nonempty, correct names) and fails if any are missing
  - when screenshots are not requested (the default), runs the same behavioral
    assertions but produces and verifies no frozen package — a successful run is
    green on behavior alone, and CI uploads no screenshot artifact for it
  - on failure, Playwright's `screenshot: "only-on-failure"` and
    `trace: "on-first-retry"` write per-test screenshots and traces into
    `test-results/`; CI uploads those as a bounded failure-diagnostics artifact
    regardless of the screenshot opt-in
  - sets `RUNESPACE_E2E_CANONICAL_HTTP=true`, which disables Better Auth `Secure`
    cookies for this runner only. Production-mode Better Auth issues `Secure`
    cookies that a plain-HTTP test origin (`http://127.0.0.1:<port>`) discards,
    dropping the session after sign-up; this gate is a test-runner-only exception
    (see `docs/authentication.md`) and is never set for CI builds, preview, or
    production.
- Agents may not report browser or CI parity as passing unless the canonical
  command actually passed.
- The canonical command is expensive by design: one invocation performs one
  full production `next build`, one `next start`, and all suites, so it spans
  several minutes. Multiple Playwright commands remain to preserve fixture and
  auth-state isolation, but the runner's explicit external-server boundary
  prevents another build or server restart for each phase. For focused local
  iteration, run the affected spec (`pnpm test:e2e <spec> --project=chromium`).
  Ordinary `pnpm test:e2e` owns its server: it uses production build/start by
  default, or a development server when `PLAYWRIGHT_DEV_SERVER=true` is set.
  Focused evidence is never a substitute for the canonical command — only
  `pnpm test:e2e:canonical` and the matching CI job establish CI parity.
- GitHub Actions remains the final authority; canonical execution must use the
  same `pnpm test:e2e:canonical` command.
- Uploading an artifact is not proof that promised evidence exists. Verify each
  expected evidence file before upload, and inspect artifact contents whenever
  evidence is part of the definition of done.

## What to test when systems arrive
For progression-sensitive systems, prioritize:
- **exploit-sensitive transitions** (e.g., granting rewards)
- **resource consumption** (fuel, materials)
- **replay / duplicate-claim prevention** (idempotent commands)
- **persistence correctness** (the stored state matches the resolved outcome)

## Avoid
- Test duplication across layers.
- Excessive shallow component tests that assert markup without behavior.
- Testing implementation details instead of observable outcomes.

## CI scope and event matrix

The `CI` workflow always runs the fast job (frozen install, typecheck, lint,
format check, unit tests, and one production build) for PR revisions and pushes
to `main`. PostgreSQL integration and canonical E2E are selected by the explicit
full-gate policy:

| Event | Fast checks | PostgreSQL + canonical E2E |
| --- | --- | --- |
| Draft PR opened, reopened, or pushed | Yes | No |
| `full-ci` applied to a draft | Yes | Yes |
| Push while `full-ci` remains applied | Yes | Yes |
| Draft converted to ready | Yes | Yes, without a code push |
| Push to a ready PR | Yes | Yes |
| Push to `main` | Yes | Yes |
| Manual `workflow_dispatch` with an explicit ref/SHA | Yes | Yes |

Other labels do not request a full gate. PR runs use a per-PR concurrency group
so obsolete work is canceled only for that PR; main and manual runs use unique
groups. The full jobs have stable required names only when they actually run.
Draft-only skipped jobs use non-required placeholder names, because GitHub marks
a skipped required job successful and would otherwise permit a bypass. Require
the actual fast, PostgreSQL, and canonical check names in the `main` branch
protection/ruleset; this repository currently has no such protection configured,
so a maintainer must verify those settings separately.

CI retains a separate PostgreSQL integration job and canonical E2E job. The
canonical runner is the single source of truth for E2E behavioral verification
in both local development and GitHub Actions; frozen review screenshots are
produced and uploaded only when explicitly requested (see §3), and per-failure
diagnostics are always retained.
