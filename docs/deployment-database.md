# Deployment Database Operations

## Current policy

RuneSpace uses one private, persistent Coolify PostgreSQL database during the
early playable-development phase. The application receives its `DATABASE_URL`
through Coolify environment configuration; never commit or print that value.

Committed Drizzle migrations are the authoritative database structure. They are
run manually, rather than at application startup or every deploy, so an operator
can review and control each schema change.

## Deployment path

Coolify must use the **Nixpacks** build pack with the repository root as its
source directory. This is RuneSpace's authoritative Coolify deployment path;
the repository `Dockerfile` is not used by the live application.

Repository configuration is in `nixpacks.toml`. It preserves the package
`build` and `start` commands, then asserts that `drizzle.config.ts`, the
committed `drizzle/meta/_journal.json` and SQL migration, and the `drizzle-kit`
executable exist. The Nixpacks Node provider honors the repository's Node 22 and
pnpm declarations and installs all package dependencies, including
`drizzle-kit`. No reduced runtime image or runtime file allowlist is configured,
so Nixpacks copies the application directory, including those verified migration
assets, into the running application container.

Coolify UI configuration selects the build pack and injects runtime environment
variables; it is not committed to this repository. The deployed runtime contains
the source and dependencies produced by that Nixpacks configuration. Keep
`DATABASE_URL` configured only in Coolify and do not expose its value.

## Apply migrations in Coolify

After merging and redeploying this Nixpacks configuration, open the
**RuneSpace application** terminal in Coolify, not the PostgreSQL resource
terminal, and run:

```bash
pnpm drizzle-kit migrate
```

The Nixpacks build log must show the installed `drizzle-kit` version after the
application build; that assertion confirms the migration config, journal, SQL,
and CLI were present in the artifact before deployment. Do not use
`drizzle-kit push` against the live database.

On a database with unapplied migrations, Drizzle reports the configuration and
applies each committed migration. A successful command exits with status `0`.
Expect output that identifies `drizzle.config.ts`, the `pg` driver, and the
migration application; it must not report a missing configuration or migration
directory. Re-running it after success should report that no migrations are
pending. After the initial RuneSpace migration, verify the application can register an
account; this confirms the Better Auth `user`, `session`, `account`, and
`verification` tables exist. Creating a character also confirms the
`player_accounts` and `characters` ownership tables exist.

If a deployed application reports a missing relation or table, first confirm it
was deployed from an image containing these migration assets, then run the
command above once from that application's Coolify terminal. Do not alter the
schema manually or add migration execution to application startup.

## Backup and restore

Before a destructive database operation, create a disposable early-development
backup from the Coolify PostgreSQL resource terminal using its configured
`POSTGRES_USER` and `POSTGRES_DB` values:

```bash
pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --file=/tmp/runespace.dump
```

Download or otherwise retain that dump outside the resource before replacing or
removing the resource. Restoring overwrites matching objects, so stop the
application first and use this only with operator approval:

```bash
pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /path/to/runespace.dump
```

## Persistence check

Create clearly disposable account and character data, then ask the operator to
restart the Coolify PostgreSQL resource. After it is healthy, sign in through
the RuneSpace application and confirm that data still exists. Remove the
disposable records when practical. Do not report this check as complete without
operator confirmation of the restart and application evidence afterward.

## Future separation

Continue using the single persistent database until the initial gameplay loop
exists or real external testers or data make development and production
separation necessary. Revisit the policy then; do not create another database
for the current phase.
