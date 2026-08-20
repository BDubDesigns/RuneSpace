# Deployment, Host, and Database Environment Topology

This document describes RuneSpace's host and PostgreSQL topology. It is
deliberately environment-oriented: it documents physical/virtual machines,
the services/processes/ports on each, the PostgreSQL servers/resources they
use, and the logical databases applications and test processes connect to. It
does **not** assume all managed work happens on one machine.

## Terminology — keep these distinct

- **host** (physical/virtual machine): the local workstation, the Hermes
  Oracle VPS, the Coolify/OpenChamber deployment host, or a GitHub Actions
  runner. Each has its own process and port namespace.
- **deployment environment**: production, PR preview, local development, a
  disposable test run. A host can host several environments; an environment
  is not a machine.
- **PostgreSQL server/resource**: one running database server (a local
  `postgres`, or Coolify's managed PostgreSQL resource). The server hosts one
  or more logical databases. Context tells whether "database" means all of it
  or one logical database.
- **logical database**: a named database inside a server (for example
  `runespace_control`, `runespace_issue_75`, `runespace_test_*`).
- **application/test process**: connects to exactly one logical database
  through its own `DATABASE_URL`.

A compact summary of the hierarchy:

```text
physical/virtual host
    -> services/processes/ports on that host
    -> PostgreSQL server/resource on that host or in a deployment environment
        -> one or more logical databases
            -> application/test process connects to one logical database
```

## Hosts are separate machines

RuneSpace is developed and deployed across four separate machines with
separate process, port, and service namespaces:

1. **Local development workstation** — Brandon's machine (Codex work included).
2. **Hermes Oracle VPS** — used for Hermes + Codex development.
3. **Coolify / OpenChamber deployment host** — runs Coolify, RuneSpace
   production, and its PR previews; Nixpacks builds here.
4. **GitHub Actions runners** — independent, ephemeral CI machines.

A service or port existing on one host does **not** imply it exists on
another. In particular, `OpenChamber` currently runs on the Coolify deployment
host; its port usage is a fact about that host only and must **never** be
copied onto the workstation, Hermes, or CI wiring without confirming the
service actually runs there. See `docs/development-workflow.md` →
"Managed-host ports, cleanup, and focused E2E" for the generic port rule.

---

## Production deployment

### Application build and runtime (Coolify / OpenChamber host)

- RuneSpace builds through **Coolify's Nixpacks** build pack with the
  repository root as its source directory. The in-repo `Dockerfile` is not
  used by the live application; `nixpacks.toml` is the authoritative build
  configuration. Nixpacks honors the repository's Node 22 and pnpm
  declarations and installs `drizzle-kit`.
- Coolify UI configuration selects the build pack and injects runtime and
  build environment variables. That configuration is **not committed** here;
  see `docs/production-diagnostics.md` for how the deployed source revision is
  (or is not) supplied at build/runtime.
- **Production is persistent application data.** It is never an automated-test
  target.
- Committed Drizzle migrations remain the authoritative schema path. They are
  run manually (not at application startup, not `drizzle-kit push`), so an
  operator reviews and controls each schema change. Migration assets travel
  with the Nixpacks artifact; the build asserts `drizzle.config.ts`, the
  committed journal, the SQL migration, and the `drizzle-kit` executable exist.
- Credentials and private host information stay out of this repository and out
  of logs. Host-level service/port reservations on the deployment host are
  local to that host and must not leak into workstation/Hermes instructions.

### Source revision identity (production)

The repository's single release-ID concept is `RUNESPACE_RELEASE_ID`: a
server-side/runtime release identity, copied into `NEXT_PUBLIC_RUNESPACE_RELEASE_ID`
(and Next's `deploymentId`) at build time. Production diagnostics and
`GET /api/build-info` both report it. **The deployment does not invent a
second release metadata system.** Whether Coolify currently supplies the exact
deployed SHA into that variable is an operator wiring step covered in
`docs/production-diagnostics.md`; a deployment that reports `unknown` should
be treated as unverified, not current. `GET /api/build-info` is the
public-safe way a reviewer asks a live deployment which source revision it was
built from, and it never exposes database or environment details.

### Apply migrations in Coolify

After merging and redeploying, open the **RuneSpace application** terminal in
Coolify (not the PostgreSQL resource terminal) and run:

```bash
pnpm drizzle-kit migrate
```

The Nixpacks build log must show the installed `drizzle-kit` version after the
application build — that assertion confirms the migration config, journal, SQL,
and CLI are present in the artifact. A successful command exits `0` and
re-running it reports no pending migrations. Do **not** use `drizzle-kit push`
against the live database.

If a deployed application reports a missing relation or table, first confirm it
was deployed from an image containing these migration assets, then run the
command once from that application's Coolify terminal. Do not alter the schema
manually or add migration execution to application startup.

> The repository's committed unit test `tests/unit/drizzle-migration-journal.test.ts`
> enforces that journal `when` values strictly increase and `idx` is contiguous
> from `0`, and that every journal tag has a matching `drizzle/<tag>.sql` file.

### Backup and restore

For a destructive database operation on the Coolify PostgreSQL resource, create
a disposable dump first using its configured `POSTGRES_USER` / `POSTGRES_DB`:

```bash
pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --file=/tmp/runespace.dump
```

Retain the dump outside the resource before replacing/removing it. Restoring
overwrites matching objects, so stop the application first and use it only with
operator approval:

```bash
pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /path/to/runespace.dump
```

### Persistence check

Create clearly disposable account and character data, then have the operator
restart the Coolify PostgreSQL resource. After it is healthy, sign in and
confirm the data still exists, then remove the disposable records when
practical. Do not report this check complete without operator confirmation of
the restart and application evidence afterward.

### Ports on the deployment host

Service/port ownership (including OpenChamber) is scoped to this host only.
Base port choices on hosts actually listening here; never port 3000 as a
"RuneSpace rule" just because it is used somewhere else.

---

## PR preview deployment (Coolify)

A PR preview is a **separate deployment environment** on the Coolify host,
reachable at:

```text
https://pr-{pullRequestNumber}.runespace.qcfailed.com
```

Coolify provisions preview deployments from the pull request and gives them
their own environment block. Available Coolify metadata confirms **preview
deployments carry a distinct preview-scoped environment** (including a separate
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `NODE_ENV`, and `RUN_MIGRATIONS_ON_START`
preview block), so preview and production are configured as separate connection
targets.

Required product/safety boundaries:

- **PR-preview data is non-production.** Its PostgreSQL target is a separate
  resource/logical-database arrangement from the production resource.
- Preview application redeploys must **not** be assumed to reset data; durable
  data may survive a redeploy.
- Manual review may leave durable preview users/characters behind.
- Preview review must **never** use production-like personal data.
- Production and preview are **not interchangeable** even though they run the
  same application code.

What is exactly known vs unknown: Coolify exposes a distinct preview env block
(confirmed); the exact preview PostgreSQL resource name/host, and whether it
shares a server with production, is **not** visible to repository code and must
be confirmed from the Coolify host before it is relied on. Do not guess a
preview logical-database name or endpoint.

Exact-preview-revision verification and preview test-data discipline are in
`docs/development-workflow.md`.

---

## Local workstation development

- The local workstation is a **separate machine** from Hermes and the
  Coolify/OpenChamber host, with its own services, PostgreSQL state, listeners,
  ports, and `.env`.
- Local development/test commands use the **local machine's own** environment
  and services.
- Supported integration/E2E commands use the repository's **disposable
  test-database** lifecycle (`runespace_test_*` sibling databases created,
  migrated, run, and dropped) rather than intentionally mutating persistent
  development data. The `*:raw` targets are internal runner details and must
  not be invoked against a development database.
- Machine-specific ports are based on services actually running locally on the
  workstation; they are not inherited from Hermes or the Coolify host.
- Private credentials/paths are not duplicated here, and Hermes's
  control-role conventions (`runespace_control` / `runespace_dev`) do **not**
  apply to the workstation unless the local setup actually proves they do.

---

## Hermes Oracle VPS development

- Hermes is a **distinct Oracle VPS**, not the Coolify/OpenChamber deployment
  host and not the local workstation. Repository path here:
  `/opt/data/workspace/RuneSpace`.
- The private environment is supplied through the **managed-host mechanism**
  (`RUNESPACE_PRIVATE_ENV` + a read-only mount), **not** by overwriting the
  repository `.env` with guessed credentials.
- `runespace_control` / `runespace_dev` and `scripts/runespace-db.mjs` are the
  authoritative Hermes issue/scratch DB boundary: they create only approved
  `runespace_issue_<n>` / `runespace_scratch_*` logical databases, refuse
  overwrite, and safely drop only validated names.
- Supported integration/E2E commands may create additional temporary
  `runespace_test_*` logical databases inside the safe local PostgreSQL server.
- **Hermes port availability is determined by listeners on Hermes itself.** Do
  not reserve port `3000` on Hermes merely because OpenChamber uses it on the
  Coolify host. If Hermes WebUI or another Hermes-host service owns a port,
  document that reservation only after confirming the actual listener/service
  mapping on Hermes. See `docs/development-workflow.md` → "Inspecting unknown
  listeners".
- The read-only `scripts/db-fingerprint.mjs` utility is the safe way to confirm
  which logical database/account/server boundary a given `DATABASE_URL` reaches
  on Hermes, per its own documented contract.

---

## GitHub Actions (CI)

GitHub Actions runners are **independent, ephemeral machines** with their own
temporary PostgreSQL service and port namespace. Two levels of disposability
apply:

1. GitHub creates a temporary PostgreSQL service for the relevant CI job.
2. RuneSpace's supported integration/E2E runner creates a temporary
   `runespace_test_*` logical database inside that service and drops it after
   the command (`finally` cleanup).
3. The entire CI service disappears with the job.

This is why CI migration/test mutation is safe — a green CI job never runs
migration or test mutation against production or preview data.

---

## Database fingerprinting (read-only connection identity)

`node scripts/db-fingerprint.mjs` lets an operator confirm which logical
database/account/server boundary a supplied `DATABASE_URL` reaches **without
printing the URL, password, query string, or any reusable credential**. It uses
the existing `pg` dependency and is strictly read-only. See the script header
for its full contract and the approved output fields.

The debug smoke on a Hermes disposable scratch database prints:

```json
{
  "database": "runespace_scratch_fp",
  "user": "runespace_dev",
  "serverPort": 5432,
  "socket": "tcp",
  "inRecovery": false
}
```

It performs no writes (a fresh scratch database still has zero public tables
after it runs) and never becomes an HTTP endpoint.

---

## Development / test database separation (recommitment, not reimplementation)

The local/CI isolation problem is solved and deliberately preserved:

- `scripts/managed-host-run.sh`: managed-host environment boundary (loads a
  private environment, requires Node 22, validates a localhost-only
  `DATABASE_URL`, never prints credentials).
- `scripts/runespace-db.mjs`: Hermes control/database boundary (requires
  `runespace_control` + `runespace_dev`, approved disposable names only).
- `scripts/disposable-test-db.mjs`: normal integration/browser test entry points
  derive a uniquely named `runespace_test_*` logical database on the same safe
  local server, apply committed migrations, run tests, and drop it in `finally`.
- `pnpm test:integration` / `pnpm test:e2e` use the disposable wrapper; the
  `*:raw` variants are internal runner targets and must not run against a
  development database.
- PostgreSQL fixtures refuse to run unless the selected database is marked as
  the expected disposable `runespace_test_*` database.
- CI supplies an ephemeral PostgreSQL service per job, and the runner still
  creates/drops its own temporary `runespace_test_*` logical database there.

Do **not** rebuild, replace, or generalize this system.