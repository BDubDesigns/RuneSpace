# RuneSpace

> **Status: Active foundation.** The repository includes authentication,
> character ownership, and a playable server-authoritative Crash Site Mining
> slice. Other gameplay systems remain intentionally scoped to approved issues.

RuneSpace is a planned browser-first, mobile-friendly, low-fi sci-fi RPG inspired
by the progression, quests, social texture, and long-term grind of old-school
MMORPGs and action-point games. It is not a RuneScape clone.

The architecture is a **modular monolith** with a **server-authoritative** game
model: the browser is never the trusted source of progression. Gameplay outcomes
are resolved by server-side domain logic and persisted server-side.

## Stack

| Concern        | Choice                                  |
| -------------- | --------------------------------------- |
| Language       | TypeScript (strict)                     |
| Framework      | Next.js (App Router) + React            |
| Styling        | Tailwind CSS                            |
| Database       | PostgreSQL                              |
| ORM            | Drizzle ORM                             |
| Validation     | Zod                                     |
| Unit tests     | Vitest                                  |
| Browser tests  | Playwright                              |
| Package mgr    | pnpm (committed lockfile)               |
| Deploy         | Docker / Coolify                       |
| Minigames      | Phaser (later, isolated boundaries)     |

Pinned versions: **Node 22**, **pnpm 9.15.4** (see `package.json`
`engines`/`packageManager`).

## Local setup

Prerequisites: Node 22, pnpm 9.15.4, Docker (for Postgres), and optionally
Playwright browsers.

```bash
# 1. Install dependencies (frozen lockfile)
pnpm install --frozen-lockfile

# 2. Start PostgreSQL (writes to a docker volume)
docker compose up -d

# 3. Configure environment
cp .env.example .env
#   (default DATABASE_URL matches docker-compose.yml)

# 4. Apply committed migrations
pnpm drizzle-kit migrate

# 5. Run the dev server
pnpm dev
#   open http://localhost:3000
```

To install Playwright browsers for local e2e tests:

```bash
pnpm exec playwright install --with-deps
```

## Environment variables

See `.env.example`. Validated at startup by `server/env.ts` (Zod).

| Var           | Required | Notes                                         |
| ------------- | -------- | --------------------------------------------- |
| `NODE_ENV`    | no       | `development` \| `test` \| `production`       |
| `DATABASE_URL`| yes      | PostgreSQL connection string for the pg Pool |

## Common commands

| Command            | Purpose                              |
| ------------------ | ------------------------------------ |
| `pnpm dev`         | Start the dev server                 |
| `pnpm build`       | Production build                     |
| `pnpm start`       | Start the production server          |
| `pnpm lint`        | ESLint (next lint)                   |
| `pnpm format`      | Prettier write                       |
| `pnpm format:check`| Prettier check                       |
| `pnpm typecheck`   | `tsc --noEmit` (strict)              |
| `pnpm test`        | Vitest unit tests                    |
| `pnpm test:integration` | Vitest PostgreSQL integration tests |
| `pnpm test:e2e`    | Playwright browser tests (local)     |

## Testing

- **Unit:** `pnpm test` (Vitest, pure domain/schema logic — fast, no DOM).
- **Integration:** `pnpm test:integration` (Vitest against PostgreSQL; apply
  committed migrations first).
- **Browser:** `pnpm test:e2e` (Playwright, focused mobile journeys). CI runs a
  dedicated Mining browser job; see `docs/testing-strategy.md`.
- **Strategy:** risk-based — pure rules, server/persistence boundaries, and a
  few critical mobile journeys. See `docs/testing-strategy.md`.

## Coolify

- The current Coolify application uses Nixpacks. `nixpacks.toml` retains the
  package `build` and `start` behavior while asserting the committed Drizzle
  migration assets are available to the runtime.
- Database migration and recovery instructions are in
  [`docs/deployment-database.md`](./docs/deployment-database.md).
- `docker-compose.yml` provides a local PostgreSQL for development. The app
  itself is run with `pnpm dev` on the host (the container only covers the DB).

## Architecture & docs

Read these before contributing:

- [`AGENTS.md`](./AGENTS.md) — rules for coding agents (scope, SSOT, extraction,
  testing, draft-PR workflow).
- [`docs/architecture.md`](./docs/architecture.md) — modular monolith,
  server-authoritative model, boundaries, dependency direction.
- [`docs/game-rules.md`](./docs/game-rules.md) — current design direction.
- [`docs/gameplay-foundations.md`](./docs/gameplay-foundations.md) —
  server-authoritative timing, progression, inventory, and action contracts.
- [`docs/component-boundaries.md`](./docs/component-boundaries.md) — extraction
  rules.
- [`docs/testing-strategy.md`](./docs/testing-strategy.md) — risk-based testing.
- [`docs/development-workflow.md`](./docs/development-workflow.md) — one
  issue/branch/draft-PR workflow.

## License

See repository settings. (No license asserted in the foundation scaffold.)
