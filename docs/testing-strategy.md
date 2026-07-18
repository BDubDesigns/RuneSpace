# Testing Strategy

RuneSpace uses a **risk-based** testing strategy. Tests focus on where bugs and
exploits are most costly: pure domain rules, server/persistence boundaries, and a
small number of critical mobile player journeys.

## 1. Unit tests (Vitest)
- Target: **pure domain rules** in `game/domain/` — calculations, state
  transitions, and validation contracts in `game/schemas/`.
- Environment: `node` (no DOM needed for pure logic).
- Must be fast, deterministic, and free of network/DB.
- The foundation scaffold includes a meaningful smoke test for the content-ID
  contract (`tests/unit/ids.test.ts`). More arrive as domain logic lands.
- Run: `pnpm test`.

## 2. Integration tests
- Target: **server/persistence boundaries** — command handlers in `server/`,
  Drizzle queries in `db/`, and end-to-end resolution of player intent against a
  real (or test) database.
- These assert that domain outcomes are actually persisted and that the server
  is the authority. Established when the first real feature lands.

## 3. Browser tests (Playwright)
- Target: a **small number** of important mobile player journeys (the smoke
  screen, then core loops as they ship). Avoid large suites of shallow UI tests.
- The scaffold includes a minimal app-loading smoke test
  (`tests/e2e/smoke.spec.ts`).
- Run locally: `pnpm test:e2e`. Playwright is **not** run in the fast CI
  workflow (see below) to keep PR checks lightweight and reliable.

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
The first CI workflow runs typecheck, lint, format check, unit tests, and
production build. Playwright is intentionally excluded from CI for now because it
requires a longer-lived browser + optional DB and would slow the fast feedback
loop. It is documented here and runnable locally. Revisit once the first
real feature ships and a stable browser matrix is justified.
