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
  source of truth for local and CI artifact verification. It:
  - requires Node 22.x
  - requires a localhost-only disposable PostgreSQL database (refuses remote)
  - selects a dedicated test port
  - removes stale authentication and test state
  - runs committed migrations
  - starts a fresh production build and server
  - runs the Mining Chromium journey
  - runs the Travel Chromium journey
  - runs the repeated Mining play-boundary check
  - preserves intentional screenshots in `artifacts/e2e-review/`
  - verifies the complete screenshot manifest (exists, nonempty, correct names)
- Agents may not report browser or CI parity as passing unless the canonical
  command actually passed.
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
PostgreSQL migration/integration-test job, and a focused Mining/Playwright job
that runs the single canonical `pnpm test:e2e:canonical` command. The canonical
runner is the single source of truth for E2E screenshots and artifact
verification in both local development and GitHub Actions.
