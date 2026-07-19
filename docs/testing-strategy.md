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
- Run locally: `pnpm test:e2e`. The focused Mining journey runs in its own CI
  job with a disposable PostgreSQL service and uploads Playwright artifacts.

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
PostgreSQL migration/integration-test job, and a focused Mining Playwright job.
