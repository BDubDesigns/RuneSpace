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
- Quick local development: `pnpm test:e2e`. Uses the dev web server and may
  reuse an existing server for speed. Does **not** count as CI-parity validation.
- The canonical CI-parity command: `pnpm test:e2e:canonical`. This is the single
  source of truth for local and CI behavioral verification, and for
  frozen-screenshot verification when screenshots are requested. It:
  - requires Node 22.x
  - requires a localhost-only disposable PostgreSQL database (refuses remote)
  - selects a dedicated test port
  - removes stale authentication and test state
  - runs committed migrations
  - starts a fresh production build and server
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
- The canonical command is expensive by design: every invocation runs a full
  production `next build` and `next start`, so one run spans several minutes
  across all suites. For a CSS or visual-only change, run the affected spec
  locally (`pnpm test:e2e <spec> --project=chromium`) as quick evidence instead
  of the full canonical run. This skips the full *suite* but not necessarily a
  build (the Playwright web server builds unless a server is already reusable or
  `PLAYWRIGHT_DEV_SERVER` is set), and it is never a substitute for the canonical
  command — only `pnpm test:e2e:canonical` and the matching CI job establish CI
  parity.
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

## CI scope
CI runs typecheck, lint, format check, unit tests, production build, a separate
PostgreSQL migration/integration-test job, and a canonical E2E browser-journey
job (Mining, Overlay, Travel, and the repeated Mining play-boundary check) that
runs the single `pnpm test:e2e:canonical` command. The canonical runner is the
single source of truth for E2E behavioral verification in both local development
and GitHub Actions; frozen review screenshots are produced and uploaded only when
explicitly requested (see §3), and per-failure diagnostics are always retained.
