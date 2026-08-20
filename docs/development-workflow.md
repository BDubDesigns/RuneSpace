# Development Workflow

Follow `AGENTS.md` for the normative architecture, scope, and agent-behavior
contract. This document provides the supporting procedure.

## One issue, one branch, one draft PR
- Fetch `origin`, then create each dedicated branch from the latest `origin/main`.
- Produce **one draft pull request** per issue. Do not open multiple PRs for the
  same issue.
- Work stops at a draft PR for human review. Do not merge unless the product owner
  explicitly instructs it to merge after review.

## Validate locally and choose the confidence level

### Managed RuneSpace hosts
On Brandon's managed RuneSpace hosts, run database-backed and Node-22-bound commands
through `./scripts/managed-host-run.sh`. The wrapper defaults to the existing private
`/home/brandon/.config/runespace/dev.env` and `/usr/bin` toolchain. A managed
container may instead provide `RUNESPACE_PRIVATE_ENV` and set
`RUNESPACE_NODE_BIN_DIR` in that private environment. In either shape, the wrapper
requires Node 22 and validates that `DATABASE_URL` is localhost-only without
printing the private file or any credentials. Do not `source` the file manually or
replace its URL with Docker example credentials.

#### Brandon's home host ONLY — DO NOT USE on Hermes (`/home/brandon/workspace/projects/runespace`)

```bash
cd /home/brandon/workspace/projects/runespace
./scripts/managed-host-run.sh pnpm install --frozen-lockfile
./scripts/managed-host-run.sh pnpm typecheck
./scripts/managed-host-run.sh pnpm lint
./scripts/managed-host-run.sh pnpm format:check
./scripts/managed-host-run.sh pnpm test
./scripts/managed-host-run.sh pnpm drizzle-kit migrate
./scripts/managed-host-run.sh pnpm test:integration

# Production build: `next build` runs as production, so server/env.ts requires a
# BETTER_AUTH_SECRET of at least 16 characters. Scope a clearly fake
# build-only placeholder to this single build invocation only, so an existing
# shell value is never overwritten or removed. The placeholder shape follows
# .github/workflows/ci.yml — the source of truth for this shape. It is valid
# for this local/CI build command only and must never be used in a deployment.
./scripts/managed-host-run.sh env \
  BETTER_AUTH_SECRET="insecure-ci-build-only-secret-do-not-use-in-prod-0000000000" \
  pnpm build

./scripts/managed-host-run.sh pnpm test:e2e:canonical
```

If `/home/brandon/.config/runespace/dev.env` is missing or unreadable,
`managed-host-run.sh` refuses to start; stop and report the environment blocker.
Never guess credentials, inspect or report the private file's contents, or use the
Coolify production database for local testing. The canonical runner's
localhost-only database safety check remains authoritative.

#### Hermes host ONLY (`/opt/data/workspace/RuneSpace`) — MANDATORY for every DB-backed command

The Hermes host supplies its private file through a read-only container mount and
sets `RUNESPACE_PRIVATE_ENV` to that mounted path. The file selects the localhost
`runespace_control` database as the dedicated `runespace_dev` role and configures
the persistent Node 22 and Playwright paths. Repository code, issue reports, and
command output must never include the file contents or complete connection string.

`scripts/runespace-db.mjs` reuses the shared localhost URL validator and adds the
RuneSpace control-role and disposable-name boundary:

- `issue-84` selects `runespace_issue_84`;
- `scratch` selects `runespace_scratch`;
- `scratch-isolation` selects `runespace_scratch_isolation`;
- every other key format is refused before a database operation.

The helper refuses to overwrite an existing database. Its `drop` command uses
PostgreSQL's force option only after validating the exact disposable name, so use a
unique issue/scratch key for every concurrent worktree. `run` first proves that the
selected database exists, then launches the requested argument vector without a
shell and with only the child process's `DATABASE_URL` changed.

```bash
cd /opt/data/workspace/RuneSpace
./scripts/managed-host-run.sh pnpm install --frozen-lockfile
./scripts/managed-host-run.sh node scripts/runespace-db.mjs create issue-84

./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm typecheck
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm lint
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm format:check
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm test
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm drizzle-kit migrate
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm test:integration
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- env \
  BETTER_AUTH_SECRET="insecure-ci-build-only-secret-do-not-use-in-prod-0000000000" \
  pnpm build
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm test:e2e:focused mining
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm test:e2e:canonical

./scripts/managed-host-run.sh node scripts/runespace-db.mjs drop issue-84
```

Run `pnpm exec playwright install --with-deps chromium` through the wrapper before
the first browser test on a fresh Hermes image. The browser download uses the
private environment's persistent `PLAYWRIGHT_BROWSERS_PATH`. Playwright 1.51 may
identify the Debian 13 Hermes image as unsupported Ubuntu 20.04 ARM64 and fail its
dependency step on obsolete font package names. When that exact compatibility
failure occurs and the host's Chromium libraries have been verified, run
`pnpm exec playwright install chromium` instead and require a passing focused and
canonical run as the browser launch proof. Do not install guessed replacement
packages. If the private mount, Node toolchain, PostgreSQL service, or selected
database is unavailable, stop and report that exact blocker; do not inspect
secrets, substitute another database, or silently fall back to GitHub Actions.

### Managed-host ports, cleanup, and focused E2E
- Port `3000` belongs to OpenChamber. Never use it for RuneSpace work and never
  kill its process.
- Port `3200` is the canonical runner's dedicated port
  (`scripts/run-canonical-e2e.mjs`).
- A focused run must use a separately confirmed-free high port, never `3000` or
  `3200`. `pnpm test:e2e:focused` defaults to `3310`, refuses to start unless
  that port is confirmed available, and accepts an override through
  `RUNESPACE_FOCUSED_E2E_PORT` (a validated high port in `1024..65535`).
- The focused runner currently supports `mining`, `character-profile`,
  `location-population`, and `character-portraits`; it does not support the
  Travel phase. To run one Travel test in isolation, start from the repository
  root, choose a separately confirmed-free high port, and let Playwright own a
  production server with the managed local environment:

  ```bash
  ./scripts/managed-host-run.sh env \
    CI=true \
    PLAYWRIGHT_PORT=3311 \
    BASE_URL=http://127.0.0.1:3311 \
    RUNESPACE_E2E_CANONICAL_HTTP=true \
    BETTER_AUTH_SECRET="canonical-e2e-local-test-secret-not-for-production" \
    RUNESPACE_RELEASE_ID=local-ci-parity \
    pnpm test:e2e tests/e2e/travel.spec.ts \
    --project=chromium \
    --grep "directional map affordances follow native scroll truth"
  ```

  Replace the `--grep` text with the exact Travel test title when diagnosing a
  different Travel failure. This is focused iteration evidence only; run
  `./scripts/managed-host-run.sh pnpm test:e2e:canonical` for CI-parity proof.
- In a restricted coding harness, a `listen EPERM` error before Playwright
  starts means the harness blocked the local test-server port. Allow loopback
  server binding and rerun the same command; it is a startup-environment
  blocker, not evidence that the E2E assertion failed.
- Cleanup: inspect listeners and owning PIDs with `ss -tlnp`, then kill only a
  positively identified RuneSpace-owned test-server PID with a targeted
  `kill <pid>`. Never use broad `pkill -f` or blanket Next.js cleanup. If the
  focused port is occupied by an uncertain process, choose another inspected
  free high port instead of killing it.
- Do not manually assemble `next build` + `next start` for browser validation on
  the managed host. Use `pnpm test:e2e:focused <phase>`, `pnpm test:e2e:canonical`,
  or the deployed PR preview unless diagnosing the runner itself.
- One focused phase from a clean state:

```bash
cd /home/brandon/workspace/projects/runespace
./scripts/managed-host-run.sh pnpm test:e2e:focused mining
```

The focused runner (`scripts/run-focused-e2e.mjs`) reuses the canonical
primitives and process supervisor from `scripts/e2e-shared.mjs`. It validates
the localhost-only database and Node 22, selects and verifies its high port,
cleans stale auth state and per-invocation Playwright output (never the curated
`artifacts/e2e-review/`), applies migrations, performs one production build with
a local build-and-runtime auth placeholder, starts the production server, waits
for readiness, runs the selected phase (`--project=chromium`), and terminates
only its own processes. Focused execution is iteration evidence only — only
`pnpm test:e2e:canonical` and the matching CI job establish CI parity.

### Generic fresh clone or Docker Compose setup
For a separately created generic local Docker database, `.env.example` contains
example Docker Compose credentials. Those credentials apply only to that Docker
database after it has been created; they must not override a managed host's
private environment.

The supported local test commands are database-isolated: `pnpm test:integration`
and `pnpm test:e2e` create a uniquely named disposable sibling database from
the local `DATABASE_URL`, apply migrations, run the fixtures, and drop the
database afterward. The canonical and focused E2E runners use the same
lifecycle. Keep the normal `pnpm dev` server pointed at the persistent `.env`
database; do not invoke the internal `test:integration:raw` or `test:e2e:raw`
commands directly.

Run affected focused checks when their required environment is available. For
example, integration tests require PostgreSQL and browser tests require the
Playwright browser dependencies and their database setup.

Canonical CI also runs PostgreSQL integration tests and the canonical E2E
browser-journey job (Mining, Overlay, Travel, and the repeated Mining
play-boundary check). A local skip or unavailable environment is not a pass:
report it as unexecuted and wait for the corresponding canonical CI result.

### Focused implementation checks, then full canonical parity

During implementation, run checks proportional to the touched boundary: unit
tests for pure rules, the relevant integration test for a persistence boundary,
or a focused Playwright spec for a browser change. When a change adds or touches
E2E specs, validate the new/targeted spec(s) first in isolation
(`pnpm test:e2e:focused <phase>` or `pnpm test:e2e -- <spec> --project=chromium`)
to catch fixture errors quickly, then run the **full** `pnpm test:e2e:canonical`
suite — the exact command GitHub's Full gate runs — before assuming the work
will pass. `fast-checks` (typecheck/lint/unit/build) intentionally skips
PostgreSQL integration and canonical E2E; a green fast run is not evidence the
merge gate will pass. Run typecheck, lint, and format checks early enough to
avoid pushing an obviously broken checkpoint. Batch related local commits into a
coherent state rather than pushing after every tiny edit.

### Draft preview checkpoint

A draft PR push always runs the fast CI job (frozen install, typecheck, lint,
format check, unit tests, and one production build). It intentionally does not
run PostgreSQL integration or canonical E2E unless the PR has the `full-ci`
label. A coherent, focused-validated draft push is therefore allowed before
full local parity when the purpose is real-device phone/desktop review. The
Coolify branch preview deploys pushed checkpoints independently of this CI
split; it is visual-review evidence, not the merge gate.

### QC Failed status manifest upkeep

`AGENTS.md` is the normative contract for the `.qcfailed/status.json` manifest
and its schema-one fields, meaningful-status upkeep, `currentChange`
active-review upkeep, rollover after merge, and infrastructure-only
non-displacement rules. This subsection is narrow supporting procedure only and
does not create competing instructions.

- A meaningful product PR updates the manifest in the same PR and adds a
  `currentChange` with the real PR number after the draft PR opens. The PR
  number becomes known only after the draft PR exists, so the workflow may make
  one narrow follow-up commit on the same branch that records it.
- The verified RuneSpace preview pattern is
  `https://pr-{pullRequestNumber}.runespace.qcfailed.com`. qcfailed.com derives
  the preview URL locally from the PR number against its allowlisted template;
  RuneSpace never writes a preview URL into `.qcfailed/status.json`.
- When a PR is backend- or UI-relevant, probe the actual derived preview
  hostname (for example `curl -sI https://pr-<n>.runespace.qcfailed.com`) and
  report the real result in the PR body rather than treating a deployment
  comment alone as reachability evidence.
- qcfailed.com remains responsible for remote validation, GitHub PR-state
  interpretation, preview probing, fallback snapshots, and public rendering.
  RuneSpace only keeps the committed manifest parseable and internally
  consistent; `pnpm test` covers that via `tests/unit/qcfailed-status.test.ts`.

### Ready-for-review and merge-gate validation

The same workflow requests the full gate when `full-ci` is applied, when a draft
is marked ready without a code push, on every new commit to a ready PR, on every
push to `main`, and through `workflow_dispatch` (with an explicit ref or SHA).
The full gate keeps the PostgreSQL integration and canonical E2E jobs separately
diagnosable. PR concurrency cancels obsolete runs only for that PR; main and
manual runs use unique groups and are not canceled by PR activity.

Require the stable checks `Install, typecheck, lint, test, build` and `Merge gate`
in the `main` branch protection/ruleset. `PostgreSQL integration tests`,
`Canonical E2E browser journeys`, `Full gate`, and `Full gate decision` remain
independently diagnosable but are not required contexts: they are intentionally
skipped on ordinary draft checkpoints. `Merge gate` explicitly fails with an
expected "draft checkpoint" message until the PR is ready, so a skipped full
job cannot falsely satisfy branch protection on the unchanged head when
`ready_for_review` triggers the full run. On a ready PR, `Merge gate` succeeds
only when both full jobs succeed. Do not require the diagnostic job names, and
verify the exact required names in repository settings after enabling
protection. This repository currently has no main branch protection configured —
API-verified for Issue #61 on 2026-08-03 (the GitHub REST branch-protection
endpoint returns `Branch not protected`, and the repository rulesets list is
empty) — so settings verification is a maintainer action outside this code
change. Treat that snapshot as dated repository state and re-verify before
acting on it.

Before marking ready or requesting final review, run the complete local
CI-parity sequence once when the managed PostgreSQL and Playwright environment
is available, request the configured separate-model review, push the merge
candidate, and follow every full remote job to a terminal state. After a
correction to a ready PR, run focused checks for that correction and let the
remote full gate rerun; do not repeat the complete local suite blindly after
every small fix.

## Self-review the diff
Before opening or updating the draft PR, inspect the final diff for scope,
duplication, premature abstraction, unjustified dependencies, accidental game
logic in UI, broken documentation links, and unsupported claims about repository
behavior.

## Draft PR content
The PR must include:
- a clear summary of what changed
- the exact branch, PR, local validation results, and canonical CI status
- `closes #<issue number>` in the PR body for the delivered issue. The closing
  keyword is a body reference that takes effect only when the PR is merged;
  merging remains the product owner's explicit action, and a branch name or PR
  title does not replace the body reference
- for UI changes, the working PR preview URL as the default visual-review
  evidence; include frozen screenshots only when explicitly requested, when the
  preview is unavailable, or when before/after frozen evidence materially helps
  review (request them in CI with the `e2e-screenshots` label)
- key architectural decisions, review approach, and unresolved questions or
  limitations
- whether gameplay, balance, persistence, or player-facing behavior changed and
  the approved decisions governing any such change

## Observe CI and deployment progress
Keep the PR draft while canonical CI runs, and follow the run to a terminal
state: continue until every required job reports success, or a genuine external
blocker is precisely documented. Do not wait for PostgreSQL or canonical jobs
that intentionally did not trigger on a draft-only checkpoint, but do not claim
the full gate is green until the PR has a real full run. Do not treat an
in-progress job as a pass, and do not claim canonical CI is green until it
actually reports success. A docs-only change may be *described* as unable to
introduce an application- or test-code regression — which explains why you
might prioritize other work while it runs — but that description is not a
substitute for the green result.

Observe by polling actual state at short, individually bounded intervals (for
example `gh pr checks <pr>` for GitHub Actions, or probing the preview URL for a
Coolify redeploy); each polling command must be bounded on its own. Never use one
long fixed `sleep` — a blind multi-minute wait is dead wall-clock and hides
whether the thing you are watching progressed or failed. Between polls you may do
other useful review or reporting work; return to poll until the run is terminal.
If a job fails, inspect the failed job and step logs, fix relevant failures on
the same branch, push the fix, and follow the replacement run to a terminal
state. Record optional improvements separately from blockers.

## Model-assisted review
For difficult reasoning or final review, use a separate model pass when the
active harness supports it. Manual model switching in OpenCode is allowed.
Unavailable delegation must not block ordinary issue work: complete a careful
self-review and document the review approach in the draft PR.
