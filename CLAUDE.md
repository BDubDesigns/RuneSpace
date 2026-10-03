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
`pnpm test` ~12s, `pnpm test:integration` ~25s, `pnpm test:e2e:canonical` ~3 min
end to end (44s production build, then 88 specs on a single worker). On the
shared one-vCPU Hermes host, the production build alone takes ~2.3 min and an
uncontended canonical run ~12 min.

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
pnpm test:e2e:canonical
```

`pnpm build` needs `DATABASE_URL` and a throwaway `BETTER_AUTH_SECRET` of at
least 16 characters. The Coolify production database is never a target, on any
host.

## Keep the working tree clean

A session stop hook flags untracked files. Do not resolve that by committing
scratch or config files onto a feature branch — that quietly widens the assigned
issue's PR, which `AGENTS.md` forbids. Delete the file, or ask which branch it
belongs on.
