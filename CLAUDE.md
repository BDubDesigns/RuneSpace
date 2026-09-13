# CLAUDE.md — RuneSpace with Claude Code

@AGENTS.md is this repository's normative agent-behavior contract and applies in
full, unchanged. Everything below is **additional**, and exists only because
Claude Code's remote/web sessions have failure modes other harnesses do not.
Do not move any of it into `AGENTS.md`.

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

## CI gates: draft red is correct

`scripts/select-ci-gate.mjs` decides both gates:

- **Merge gate** is required only when the PR is **not** a draft. Red on a draft
  is by design (`Draft checkpoint: merge validation is intentionally
  unsatisfied.`). It is not a failure, not something to fix, and not worth
  reporting more than once.
- **Full gate** turns on automatically for `ready_for_review`. Flipping the PR
  to Ready runs PostgreSQL integration and canonical E2E with no label needed.

**Do not apply the `full-ci` label.** It only forces the heavy jobs onto a draft,
where they then re-run on every push. Brandon decides when full CI runs, by
marking the PR ready.

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

Approximate timings in this container, so nothing looks hung: `pnpm test` ~12s,
`pnpm test:integration` ~25s, `pnpm test:e2e:canonical` ~3 min end to end
(44s production build, then 88 specs on a single worker).

## Local validation in the remote container

`./scripts/managed-host-run.sh` does **not** work here: it expects Brandon's
private environment file on the managed host and exits. This container has its
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
