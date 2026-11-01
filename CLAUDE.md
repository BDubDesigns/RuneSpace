# CLAUDE.md — RuneSpace with Claude Code

**Read `AGENTS.md` in full before planning any change.** It is this repository's
normative agent-behavior contract and applies unchanged; this file never
replaces or overrides it. It is imported here as @AGENTS.md, but read it
yourself rather than assuming the import resolved — until recently this file
*was* `AGENTS.md`, by symlink, and losing it silently would be worse than any
problem the section below solves.

Everything below is **additional**, and exists only because Claude Code's
remote/web sessions have failure modes other harnesses do not. Do not move any
of it into `AGENTS.md`.

## Open the PR yourself when an issue is done

`AGENTS.md` step 7 requires one PR per finished issue, and this section is the
standing authorization for it. A generic "do not create a pull request unless
asked" default does **not** apply in this repository: when the assigned issue's
work is finished and its focused validation has passed, open the PR yourself as
the final step, without waiting to be asked. Follow `AGENTS.md` for its content
(`closes #<n>`, branch identity, validation, limitations, behavior changes), open
it as a normal PR rather than a Draft unless the work is genuinely unfinished,
and still **never merge**; the owner decides that. If a task names a different
instruction ("don't open a PR yet"), that one wins.

## Never self-schedule wake-ups

Do not create recurring check-ins with `send_later` or `create_trigger` to watch
a PR, poll CI, or "keep an eye on" anything. Every wake-up replays the entire
conversation through the model, so a check-in that finds nothing changed still
costs a full context pass — a day of hourly PR checks can burn a large share of
a session's budget while producing no work.

If a PR is green and waiting on a human, it is finished from the session's side.
Say so and stop. Ask before scheduling anything recurring.

The same applies to `subscribe_pr_activity`: subscribe only when asked, and
unsubscribe once the PR is green and waiting on review. The preview bot posts on
every push (in-progress, then ready) and each post wakes the session.

## CI: every PR push runs everything

Each push to a PR, Draft or not, starts fast checks, PostgreSQL integration, and
three canonical E2E shards together, and `Merge gate` requires all of them. A red
`Merge gate` is a real failure to read and fix, never an expected draft state.
Do not add labels to force CI; `e2e-screenshots` is Brandon's call.

## Reading PR state cheaply

The PR body on a large change is ~14k tokens; re-fetching it to check status is
pure waste. Use `pull_request_read` with `get_check_runs`, `get_reviews`, or
`get_review_comments`, and only fetch the body when you intend to rewrite it.

## Waiting for long commands

Never poll with `pgrep -f <pattern>` when the waiting command's own command line
contains that pattern — the waiter matches itself and loops until the harness
timeout. Poll the run's log for its terminal line instead, e.g.

```bash
until grep -q "All canonical E2E checks passed\|FAIL" run.log; do sleep 15; done
```

Approximate timings in an isolated cloud container, so nothing looks hung:
`pnpm test` ~12s and `pnpm test:integration` ~25s. A full canonical run is
not a cloud-session step (see below); one attempt reached only 310 of 394 specs
in ~13 min before it was killed. On the shared one-vCPU Hermes host, the production
build alone takes ~2.3 min and an uncontended canonical run ~12 min.

## Local validation in an isolated cloud container

Sessions whose worktree is under `/opt/data/workspace/RuneSpace` are on the
shared Hermes host instead, not in an isolated container: there,
`./scripts/managed-host-run.sh` works, and canonical E2E runs on GitHub. Follow
"Shared-host E2E" in `docs/development-workflow.md`.

In an isolated cloud container, `./scripts/managed-host-run.sh` does **not**
work: it expects Brandon's private environment file on the managed host and
exits. This container has its
own PostgreSQL instead. Start it as its owner and pass a localhost URL to the
disposable-database wrapper, which creates and drops its own database:

```bash
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/pg-runespace -l /tmp/pg.log start"
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/postgres"
pnpm test:integration
```

**Claude Code cloud sessions must not run the full canonical E2E suite
(`pnpm test:e2e:canonical`) unless the owner explicitly authorizes it for that
task.** GitHub Actions owns full canonical validation: every PR push runs it,
and `Merge gate` reports it. Push, open the PR, and read the checks.

Validate proportionally instead: unit tests, `pnpm test:integration` (or the
specific integration files), and, where a browser is needed, a focused run of
the one relevant spec (`pnpm test:e2e:focused <phase>`). When a GitHub CI test
fails, read the failing job's log, then diagnose and reproduce only that spec or
subsystem locally — never the whole canonical suite — fix it, and push so CI
re-verifies. A new E2E spec must also be registered in `canonicalSpecPattern`
(`playwright.config.ts`) and `FOCUSED_PHASES` (`scripts/run-focused-e2e.mjs`),
or CI will silently never run it.

Focused Playwright execution in a cloud container may fail with
`Executable doesn't exist … chromium_headless_shell-<n>`: the repository's
pinned Playwright can expect a different browser build than the one
pre-installed under `/opt/pw-browsers`. Recurring workaround, kept outside the
repository: create a scratch directory (not in the worktree) containing a
`chromium_headless_shell-<n>/chrome-linux/headless_shell` symlink to the
installed headless-shell binary and an `INSTALLATION_COMPLETE` file, then set
`PLAYWRIGHT_BROWSERS_PATH` to that directory for the focused run. This is a
best-effort local aid, not a guarantee of version compatibility; do not edit
the Playwright configuration or commit the symlink, and treat GitHub CI as the
authority if behavior differs.

`pnpm build` needs `DATABASE_URL` and a throwaway `BETTER_AUTH_SECRET` of at
least 16 characters. The Coolify production database is never a target, on any
host.

## Keep the working tree clean

A session stop hook flags untracked files. Do not resolve that by committing
scratch or config files onto a feature branch — that quietly widens the assigned
issue's PR, which `AGENTS.md` forbids. Delete the file, or ask which branch it
belongs on.
