# Development Workflow

Follow `AGENTS.md` for the normative architecture, scope, and agent-behavior
contract. This document provides the supporting procedure.

## Agent instruction loading audit and RuneSpace operating ceiling

This audit was recorded on 2026-09-05 against the fresh `origin/main` snapshot
(`2ab026b`). It distinguishes measured runtime behavior from documentation or
source evidence. Harness limits are version/configuration-sensitive and the
RuneSpace ceiling below is an intentional repository policy, not a universal
harness limit.

### Fresh-main baseline

The `origin/main` `AGENTS.md` measured:

| Metric | Value | Method |
| --- | ---: | --- |
| UTF-8 bytes | 19,584 | `wc -c` |
| Unicode code points | 19,528 | UTF-8 `wc -m` |
| Lines | 315 | `wc -l` |
| Words | 2,537 | `wc -w` |
| Rough tokens | 4,882 | code points divided by four; documented approximation, not tokenizer output |

The cumulative UTF-8 byte count crossed 4 KiB after line 75 (4,142 bytes),
8 KiB after line 134 (8,267 bytes), and 16 KiB after line 264 (16,430 bytes).
Future instruction-size reports should repeat these measurements for the exact
fresh-main and final files rather than relying on this snapshot.

### Harness findings

| Harness/version | Discovery and composition | Size/truncation finding | Evidence classification |
| --- | --- | --- | --- |
| Codex CLI 0.153.4 | Official guidance describes global and project instruction files composed from project root toward the working directory, with nearer guidance later in the chain. | The official AGENTS guide describes a default 32 KiB `project_doc_max_bytes` limit for the combined chain, while the advanced configuration reference describes the setting as bytes read from each `AGENTS.md`. This scope wording is unresolved. | Documentation evidence from the [Codex AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced). A local sentinel probe was not completed because the restricted environment could not create Codex's state database; no measured Codex truncation behavior is claimed. |
| Hermes runtime 0.20.0 | On host `brandonsvnic`, the inspected source is `/home/ubuntu/hermes-agent-src/agent/prompt_builder.py` (lines 1282, 1312–1330, and 1964–1986). The source tree is not a Git checkout; its file mtime is 2026-08-06 05:42:57 UTC, package metadata reports `1.0.0`, and the imported runtime reports `hermes_cli.__version__ == 0.20.0`. It loads `AGENTS.md` from the explicit working directory, selects one project-context type by priority, and wraps the selected content in its prompt. | With no configured override, the source default is 20,000 **characters**. An explicit `context_file_max_chars` key in `/home/ubuntu/.hermes/config.yaml` is read through `load_config_readonly()` and wins over the dynamic/default calculation; that key was `not-configured` on the inspected host. No environment-variable override mechanism was verified, so none is claimed. Oversize content keeps a head and tail with an omission marker and warning. | Source evidence was confirmed by a real sentinel probe: a 20,029-character synthetic `AGENTS.md` produced 18,178 characters with both sentinels retained, an omission marker, and an explicit truncation warning. This is measured Hermes behavior for the inspected runtime/source, not a claim about every Hermes version. |
| OpenCode 1.17.13 | `opencode debug paths` reported `/home/brandon/.local/share/opencode/log`; exact evidence is in `/home/brandon/.local/share/opencode/log/opencode.log` at lines 44778, 44818, 44869, 46291, and 46319. Those entries record evaluated permission glob patterns containing `AGENTS.md`, including `**/{AGENTS.md,CLAUDE.md,CONTRIBUTING.md,.cursorrules}` and `**/{AGENTS.md,CONTRIBUTING.md,.github/agents/**,.opencode/**}`. | Composition behavior: **unknown**. Size limit: **unknown**. Truncation behavior: **unknown**. Configurability: **unknown**. No sentinel probe was completed and no source/configuration artifact exposing those behaviors was verified. | Measured local command/log evidence establishes discovery only; it does not establish composition or size behavior. |

### RuneSpace policy: 16 KiB operating ceiling

RuneSpace chooses a 16,384-byte UTF-8 ceiling for the root `AGENTS.md`, enforced
by `tests/unit/agent-instructions.test.ts`. This is a **RuneSpace operating
ceiling**, not a discovered hard limit imposed by Codex, Hermes, or OpenCode.
It is intentionally conservative because Hermes describes its cap in characters
while the repository guard measures bytes; byte counting also remains safe if
future instructions contain more multibyte text. The ceiling leaves headroom
below the inspected Hermes 20,000-character default and the documented Codex
32 KiB setting, while avoiding dependence on OpenCode's unverified limit.

Keep high-priority scope, authority, SSOT, safety, validation, and review rules
in the root file. Move detailed procedures to the existing focused documents
linked by `AGENTS.md`; do not solve size pressure by weakening critical policy
or creating a documentation maze. If a harness version or configuration changes,
repeat the audit and update this record with measured evidence.

## One coherent change, one branch, one PR
- Fetch `origin`, then create each dedicated branch from the latest `origin/main`.
- Each PR is **one coherent, bounded change**. Normally that is one issue. Do not
  open multiple PRs for the same issue.
- Several tracked issues may share one PR **only when the product owner
  explicitly approves that bundle**, for example on the lead issue. Without that
  approval, a related issue found along the way is reported, or filed with its
  evidence, not folded in. Approval covers that bundle only; it does not license
  umbrella PRs or widening feature PRs.
- A bundle keeps the single-issue discipline: one lead branch and worktree from
  fresh `origin/main`, one isolated database key (the lead issue's), one PR,
  and the full required validation once for the combined change. Work each
  issue through its own evidence and focused tests, and commit it separately
  where practical.
- Completion stays truthful per issue. The PR body states each issue's outcome
  and uses `closes #<n>` only for issues whose done-criteria are met; an issue
  that is not resolved stays open with its evidence recorded.
- Open a normal PR by default. Draft is optional and only signals genuinely
  unfinished work; it changes neither which checks run nor whether `Merge gate`
  can pass.
- Work stops at the PR for human review. Do not merge unless the product owner
  explicitly instructs it to merge after review.
- Issue and PR state are authoritative for routine work. Agents do not move
  GitHub Project board cards; the board is an optional owner tool, and its
  fields and workflows are not changed as part of an issue.

## Retiring a merged issue's worktree

Each issue gets its own worktree (above). Nothing removes it afterward: merging
the PR on GitHub, deleting the remote branch, and archiving the agent session
each leave the laptop-local directory in place, and none of them is proof that
the directory is disposable. Retire one only through this procedure. It needs no
daemon or scheduled job; it runs when a session is started or asked to, so a
laptop that was off at merge time catches up at the next session.

### Lifecycle

1. **PR open:** keep the worktree, including through review and CI repair.
2. **PR merged:** Brandon merges and may archive the session without saying
   anything more. Nothing is removed at merge time, and the worktree waits for a
   later session.
3. **Next session:** after creating its own fresh worktree, a session removes a
   previous session's worktree under the standing authorization below, one exact
   path at a time, but only when every check in "Verify one candidate" passes.
   It asks Brandon nothing per worktree. Anything that fails or cannot be
   checked is left alone and reported in its first message, and the assigned
   issue continues either way.
4. **Leave it and report** whenever a check is unknown, ambiguous, or fails.
   Uncertain or inaccessible worktrees stay untouched.

**Standing authorization.** Brandon has authorized routine cleanup of completed
sessions' worktrees (granted on PR #303), so no per-worktree approval is needed.
It covers one thing: an agent may remove a previous session's worktree after
**independently verifying** all of the following for that exact path. The
agent's own checks supply the evidence; neither Brandon's merge nor an archived
session does.

- its PR was **merged** on GitHub, matched by repo, branch, and head commit;
- the session is **finished**: the PR is merged and nothing is using the worktree
  (below). Where a live session could be running somewhere this machine cannot
  see, finished is not established;
- the worktree is **clean**, with no tracked, staged, or untracked changes;
- it is **unlocked**, and **nothing is actively using it**.

The authorization does not extend to:

- an active or uncertain worktree, including another agent's active worktree on
  the Hermes host (see "Concurrent agent work on Hermes");
- the first cleanup of accumulated historical worktrees on Brandon's laptop,
  which still needs the read-only inventory and his separate approval (see
  "Inventory");
- any safety rule in this section: no `--force`, `rm -rf`, `git clean`, bulk
  branch deletion, or removal of the primary or current worktree.

If any check cannot be completed, leave the worktree alone and report it.
An agent must not widen this authorization or edit this paragraph to grant
itself more; only Brandon changes it, and he can revoke it at any time.

Scope: worktrees on the machine you are running on. Never touch another
repository, a database, Docker volume, preview deployment, or production state.

### Inventory (read-only)

Discover real paths; do not assume any. Nothing here changes anything.

```bash
git fetch origin main
git worktree list --porcelain          # path, HEAD, branch, locked, prunable
git rev-parse --show-toplevel          # the current worktree: never removable
# per worktree <path>:
git -C <path> status --porcelain --untracked-files=all
git -C <path> status --short --ignored          # review ignored files too
```

Classify each worktree, and report the exact evidence for each:

| Class | Meaning | Action |
| --- | --- | --- |
| primary | First `git worktree list` entry (main checkout) | never remove |
| current | Contains your working directory | never remove |
| active | Locked, open PR, session in use, or a process has it as its cwd | keep |
| candidate | Passes every check in "Verify one candidate" | remove under the standing authorization |
| dirty/unknown | Any modification, staged change, untracked file, detached HEAD, missing or ambiguous PR, or unreadable path | keep, report |
| stale | Marked `prunable`: its directory is already gone | see "Stale registrations" |

The **initial historical cleanup** on a laptop that has already accumulated
worktrees starts with this inventory as a table (path, branch, PR and state,
status, lock, class, proposed action) and stops for Brandon's explicit approval
of the listed candidates; the standing authorization does not cover it. After
that approved first cleanup, routine cleanup needs no report beyond the verified
result.

### Verify one candidate

Run these for the exact path and branch. All must pass; `git branch --merged` and
"the branch looks old" are not evidence, and squash merges make the former
useless anyway.

1. **Not protected:** not the primary or current worktree, no `locked` line in
   the porcelain output, and a `branch refs/heads/<branch>` line (not detached).
2. **Merged on GitHub, by identity:**

   ```bash
   gh pr list --repo BDubDesigns/RuneSpace --head <branch> --state all \
     --json number,state,mergedAt,headRefOid,isCrossRepository,mergeCommit
   ```

   Require exactly one PR, `state` `MERGED` with `mergedAt` set, and
   `isCrossRepository` false. `CLOSED` without a merge is not sufficient. Any
   other PR open on that branch is a stop. Require
   `git rev-parse <branch>` to equal `headRefOid`: a local commit the PR never
   carried is unmerged work. Confirm the merge landed on the default branch with
   `git merge-base --is-ancestor <mergeCommit.oid> origin/main`.
3. **Clean:** the `status --porcelain --untracked-files=all` output above is
   empty. In the `--ignored` output only regenerable build or dependency
   directories (`node_modules`, `.next`, build output, `*.tsbuildinfo`) may
   appear; env files, notes, local data, or anything else is a stop. Do not
   stash, reset, or clean to make a worktree pass.
4. **Not in use:** no process has the path as its working directory
   (`lsof -d cwd -Fn | grep -E "^n<path>(/|$)"` prints nothing), and on the
   Hermes host `/tmp/runespace-e2e.lock` is not held from that worktree. These
   see only this machine. If the worktree might belong to a session running
   elsewhere, or a check cannot run, the worktree is uncertain: leave it and
   report.

### Remove and verify

```bash
git worktree remove <exact-path>       # never --force; never rm -rf; never git clean
git worktree list --porcelain          # the path must no longer appear
test ! -e <exact-path>                 # and the directory must be gone
```

Report a removal only after both checks confirm that exact worktree is gone.
If `git worktree remove` refuses (it also refuses locked, modified, and
untracked worktrees), report the error and stop; do not retry with `--force` or
`-f -f`, and do not delete the directory some other way. Remove candidates one at
a time and re-run the list after each.

The local branch is a separate decision. Leave it. Delete it only when Brandon
asks, for that exact branch, after the PR check above passed (a squash-merged
branch needs `git branch -D`, which is acceptable only under that explicit
request). Never delete branches in bulk, and do not conflate it with the
remote branch, which GitHub may already have deleted.

### Stale registrations

`git worktree prune` removes registrations whose directories are already
missing; it deletes no directory and is not a substitute for `git worktree
remove`. Inspect first:

```bash
git worktree prune --dry-run -v        # lists exactly what would be removed
```

Confirm every listed path is genuinely gone and not merely on an unmounted
volume or network share, which also reads as missing. Only then run
`git worktree prune`, and re-list to confirm.

### Not part of this procedure

No GitHub Action or other background job deletes laptop-local files. Other
repositories (QC Failed, ParkQuest) are never edited from a RuneSpace issue;
note any wish to adopt this there separately. A helper script is deliberately
not provided: the inventory is a few read-only commands, removal must stay a
per-path decision, and a script would be new code to keep safe. Revisit that only
if the first laptop audit shows the same steps repeated enough to justify it,
and then test it against disposable temporary repositories, never real
worktrees.

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

- `issue-<positive-number>` (for example `issue-84`) selects
  `runespace_issue_<number>`;
- `scratch` selects `runespace_scratch`;
- `scratch-isolation` selects `runespace_scratch_isolation`;
- every other key format is refused before a database operation.

The helper refuses to overwrite an existing database. Its `drop` command uses
PostgreSQL's force option only after validating the exact disposable name, so use a
unique issue/scratch key for every concurrent worktree. `run` first proves that the
selected database exists, then launches the requested argument vector without a
shell and with only the child process's `DATABASE_URL` changed.

```bash
cd <your dedicated worktree>   # see "Concurrent agent work on Hermes" below
./scripts/managed-host-run.sh pnpm install --frozen-lockfile

# Static and unit checks need Node 22 but no database: the wrapper alone is enough.
./scripts/managed-host-run.sh pnpm typecheck
./scripts/managed-host-run.sh pnpm lint
./scripts/managed-host-run.sh pnpm format:check
./scripts/managed-host-run.sh pnpm test

# Database-backed commands run against a validated disposable database.
./scripts/managed-host-run.sh node scripts/runespace-db.mjs create issue-84
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm drizzle-kit migrate
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm test:integration
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- env \
  BETTER_AUTH_SECRET="insecure-ci-build-only-secret-do-not-use-in-prod-0000000000" \
  pnpm build
./scripts/managed-host-run.sh node scripts/runespace-db.mjs run issue-84 -- pnpm test:e2e:focused mining
# Canonical E2E runs on GitHub from this host; see "Shared-host E2E" below.

./scripts/managed-host-run.sh node scripts/runespace-db.mjs drop issue-84
```

#### Concurrent agent work on Hermes

Several agents share this host. Keep them from colliding:

- Work in a dedicated git worktree on its own branch, never in the shared primary
  checkout: `git fetch origin main`, then
  `git worktree add <path> -b <branch> origin/main` (or use the worktree your
  session was given). Run every command from that worktree.
- Use a unique `issue-<n>` database key per concurrent worktree; the helper
  refuses to overwrite an existing database, and `drop` targets only that name.
- Never modify, rebase, or clean up another agent's worktree or branch, and do not
  touch its disposable database, processes, or `/tmp/runespace-e2e.lock`.
- Sibling branches must not depend on one another before merge: branch from
  `origin/main`, and if a sibling merges first, rebase onto the new `origin/main`
  rather than onto the sibling's branch.
- Local browser runs go through `pnpm test:e2e:focused <phase>` only, which queues
  on the host-wide lock (see "Shared-host E2E"); prove canonical on GitHub.

On Hermes, `gh` is at `$HOME/.local/bin/gh`, which is **not** on the default
`PATH`: prefix each call with `PATH=$HOME/.local/bin:$PATH`. That directory also
holds a broken `python3` shim (it points at a missing `/app/venv`), so with it on
`PATH` call `/usr/bin/python3` explicitly for any script.

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

### Shared-host E2E: one run at a time, canonical on GitHub

Several agent sessions work from separate worktrees on the Hermes host, which has
one vCPU. Both local runners (`pnpm test:e2e:canonical` and
`pnpm test:e2e:focused`) therefore take one host-wide lock,
`/tmp/runespace-e2e.lock` (issue #251), before migrations and the production
build, and hold it until their own teardown finishes.

- A runner that finds the lock held logs the holder's PID, runner label,
  worktree, and how long it has held the lock, then waits and starts
  automatically once it is released. It logs again every five minutes while it
  waits.
- Queue time does not count against `RUNESPACE_CANONICAL_TIMEOUT_MS` or
  `RUNESPACE_FOCUSED_TIMEOUT_MS`; those timers start once the lock is held. The
  wait has its own limit, `RUNESPACE_E2E_LOCK_WAIT_MS` (default 60 minutes),
  after which the runner fails and names the holder.
- Ctrl-C or SIGTERM while waiting exits promptly without taking the lock; after
  acquisition, the runner's normal teardown releases it.
- A holder that died without cleanup (for example SIGKILL) is detected by PID and
  process start time, and the next runner reclaims the lock and logs that it did.
  Do not delete the lock file by hand: if its holder is alive, a run is in
  progress.
- GitHub Actions skips the lock. The bypass is keyed on `GITHUB_ACTIONS=true`,
  never `CI`, because both local runners set `CI=true` in their child
  environment for CI parity.
- `pnpm test:e2e` and `pnpm test:e2e:studio` start their own server through
  Playwright's `webServer` and do not take the lock; use the focused or canonical
  runner on this host.

A serialized canonical run on the otherwise idle Hermes host measured 11 min 45 s
on 2026-09-28 (2 min 17 s build, 9 min 24 s of Playwright), against about three
minutes across GitHub's three shards. So on Hermes:

- During implementation, run unit, integration, and focused E2E proportional to
  the touched boundary.
- Prove the full canonical gate on GitHub: every push to the PR runs it
  automatically (see "CI and the merge gate").
- A manual run is optional, for reproducing or debugging a revision outside its
  PR, for example a pushed branch that has no PR yet:

  ```bash
  git push -u origin <branch>          # the run can only see pushed commits
  gh workflow run ci.yml --ref <branch> -f ref=<branch-or-sha>
  gh run list --workflow ci.yml --event workflow_dispatch --branch <branch> \
    --limit 1 --json databaseId,headSha -q '.[0]'
  gh run watch <run-id> --exit-status
  ```

  The two refs do different jobs. `--ref` chooses which branch's copy of
  `ci.yml` GitHub executes; the `ref` input chooses what RuneSpace checks out and
  tests. Give both. With only the input, GitHub runs the workflow definition from
  the default branch, so a branch that edits `ci.yml` is validated by main's
  workflow (reproduced during #242). Pass the pushed branch name, not a local-only
  SHA, and confirm that `headSha` equals `git rev-parse HEAD`. A manual run is
  evidence for the agent; the PR's own run is the authoritative merge gate.
- Do not start a local canonical run because another worktree is running one.
  Run canonical locally only to reproduce or debug a CI failure; the lock then
  queues it behind every other local run.

### Managed-host ports, cleanup, and focused E2E

Port rules are **host-specific**. A service/port existing on one host (for
example OpenChamber on the Coolify/OpenChamber deployment host) is **not** a
RuneSpace fact on any other host. The machine you are on is the only machine
whose listeners matter, and you must inspect them before assuming what is or
is not free. The durable generic rule is:

> Never assume an arbitrary port is free and never kill an unknown listener.
> Inspect the current machine's listeners and ownership first. Use RuneSpace's
> explicitly designated canonical/focused ports where the runner owns them;
> otherwise select a confirmed-free appropriate port. Kill only a positively
> identified RuneSpace-owned test process when cleanup is required.

Confirmed on the Hermes Oracle VPS (2026-08): no RuneSpace system port is
reserved host-wide. The only RuneSpace port usage is the `3200` canonical port
and the `3310` focused default while the corresponding runner is running. Port
`3000` is **not** reserved for RuneSpace or OpenChamber on Hermes; it is
simply an unclaimed port here.

- Port `3200` is the canonical runner's dedicated port
  (`scripts/run-canonical-e2e.mjs`).
- A focused run must use a separately confirmed-free high port, never the
  canonical runner port `3200`, and never `3000` unless the actual listener on
  *this* host is confirmed free (on Hermes it currently is; on a host running
  OpenChamber it is not). `pnpm test:e2e:focused` defaults to `3310`, refuses
  to start unless that port is confirmed available, and accepts an override
  through `RUNESPACE_FOCUSED_E2E_PORT` (a validated high port in
  `1024..65535`).
- The focused runner currently supports `mining`, `character-profile`,
  `location-population`, `character-portraits`, `cargo-hold`, `inventory-equip`,
  `travel`, `walk-it-off`, `cut-your-teeth`, `refining`, `bounded-runs`,
  `rusk-recovery`, `fabrication`, `work-orders`,
  `gameplay-access`, `account-verification`, `social-shell`, `public-chat`, `whispers-safety`, `moderation`, `player-trading`, `system-notices`, `chat-social-polish`, `desktop-workspace`, `site-stash`, and `curly-must-stash` (the focused runner also puts the fixed loopback test
  operator on the admin allowlist, as the canonical runner does). To run one Travel test in
  isolation, use the same disposable lifecycle with `travel`:

  ```bash
  ./scripts/managed-host-run.sh pnpm test:e2e:focused travel
  ```

  This is focused iteration evidence only; the PR's CI run proves canonical
  parity.
- In a restricted coding harness, a `listen EPERM` error before Playwright
  starts means the harness blocked the local test-server port. Allow loopback
  server binding and rerun the same command; it is a startup-environment
  blocker, not evidence that the E2E assertion failed.
- Cleanup: inspect listeners and owning PIDs, then kill only a positively
  identified RuneSpace-owned test-server PID with a targeted `kill <pid>`.
  Never use broad `pkill -f` or blanket Next.js cleanup. If the focused port is
  occupied by an uncertain process, choose another inspected free high port
  instead of killing it.

### Inspecting unknown listeners safely

Never guess what owns a port on a machine you have not inspected, and never
kill an unidentified process to obtain a port. Prefer a listener tool on the
current host:

```bash
# where ss or netstat is installed
ss -tlnp        # listening TCP sockets + owning PIDs (may need privilege for PIDs)
# where ss/netstat are absent (Hermes Oracle VPS is one such host), read the
# kernel socket table directly; port is little-endian hex, st "0A" == LISTEN:
node -e 'const {readFileSync}=require("fs");["tcp","tcp6"].forEach(f=>{try{const L=readFileSync("/proc/net/"+f,"utf8").trim().split("\n").slice(1);for(const r of L){const p=r.trim().split(/\s+/);if(p[3]==="0A"){const [a,h]=p[1].split(":");console.log(f,a,parseInt(h,16))}}}catch(e){}})'
```

Only after positively identifying the owning process may you kill a
RuneSpace-owned test server for cleanup.
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
cleans per-invocation Playwright output (never the curated
`artifacts/e2e-review/`), applies migrations, performs one production build with
a local build-and-runtime auth placeholder, starts the production server, waits
for readiness, runs the selected phase (`--project=chromium`), and terminates
only its own processes. Focused execution is iteration evidence only — only
`pnpm test:e2e:canonical` and the matching CI job establish CI parity.

Issue #139's canonical browser contract is intentionally narrower than the
whole `tests/e2e/` directory: the Playwright config allowlists the existing
behavioral specs and excludes smoke, ownership, design-system, and QC Studio
coverage from the Full/Merge browser gate. Ordinary authenticated tests use one
worker-scoped Better Auth session and one fresh server-created character per
test. The admin operator spec remains serial because its fixed identity and
process-global allowlist are the explicit shared boundary, and the
gameplay-access spec (issue #223) is serial and chromium-only because it alone
changes the global public-gameplay row; sign-out, portraits, registration, and
character creation retain independent sessions.

The canonical runner invokes that selection once with zero retries and
retain-on-failure traces. GitHub runs three `--shard` jobs concurrently, each
with its own PostgreSQL service, disposable database, and production server.
The initial local/CI benchmark uses two Playwright workers; keep timing summaries
from `.playwright/canonical-timing-*.json` and choose a later worker count from
GitHub wall-clock and stability evidence rather than treating two as a permanent
target. Curated review screenshots are opt-in only: the `e2e-screenshots` label
runs a separate deterministic one-worker, unsharded lane using the same
selection and fixtures. The normal three behavioral shards do not generate that
manifest. For the Issue #139 stress evidence, run inventory-equip at least ten
times with at least two workers and zero retries, plus a repeated state-heavy
gameplay spec in parallel with zero retries; report failures, retries, and wall
clock separately from the canonical gate.

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

Canonical CI also runs PostgreSQL integration tests and three concurrent shards
of the explicit canonical E2E behavioral selection. A separate one-worker
screenshot lane runs only when the `e2e-screenshots` label is requested. A local
skip or unavailable environment is not a pass: report it as unexecuted and wait
for the corresponding canonical CI result.

### Focused local checks, full remote CI

During implementation, run checks proportional to the touched boundary: unit
tests for pure rules, the relevant integration test for a persistence boundary,
or a focused Playwright spec for a browser change. When a change adds or touches
E2E specs, validate the new/targeted spec(s) in isolation
(`pnpm test:e2e:focused <phase>`; on hosts without the managed-host lock,
`pnpm test:e2e -- <spec> --project=chromium` also works — never on Hermes, where
it bypasses the host-wide lock) to catch fixture errors quickly. Run typecheck,
lint, format, and unit checks before pushing so a checkpoint is not obviously
broken, and batch related local commits into a coherent state rather than
pushing after every tiny edit.

The full canonical suite, PostgreSQL integration, and the fast checks then run
on GitHub for every PR push. Do not repeat the complete local suite as a routine
duplicate of that run. Run `pnpm test:e2e:canonical` locally when reproducing or
diagnosing a CI failure, or when a change genuinely crosses a high-risk boundary
and earlier local evidence is worth the cost; from the shared Hermes host, rely
on GitHub instead (see "Shared-host E2E"). A green fast-checks job alone is not
evidence the merge gate will pass, and a local skip or unavailable environment
is reported as unexecuted, never as a pass.

The Coolify branch preview deploys pushed revisions independently of CI. It is
visual-review evidence, not the merge gate, and preview review can proceed while
CI runs.

### Exact-preview-revision verification

An HTTP 200 from a preview only proves a deployment is alive; it does not prove
the preview contains the latest PR head. Before beginning live UI/behavior
review of a preview, verify the preview is serving the exact source revision
you intend to review. The preview hostname is derived from the PR number:

```text
https://pr-{pullRequestNumber}.runespace.qcfailed.com
```

The deployment reports its source revision through the public build-info
boundary, `GET /api/build-info`, which returns:

```json
{ "releaseId": "<exact deployed source revision or 'unknown'>" }
```

Short bounded procedure (ordinary GitHub tooling + curl; no long sleeps, no
background daemon, and **never** a new GitHub CI network dependency):

1. Obtain the current GitHub **PR head SHA**:
   ```bash
   gh pr view <N> --repo BDubDesigns/RuneSpace --json headRefOid --jq .headRefOid
   ```
2. Request the preview build-info endpoint:
   ```bash
   curl -s https://pr-<N>.runespace.qcfailed.com/api/build-info
   ```
3. Compare the reported `releaseId` to the expected PR head SHA, normalizing
   only the representation needed for a legitimate exact comparison.
4. Require an **exact/unambiguous match** before beginning live review.
5. Reachable but older/different revision → call it a **stale deployment** and
   wait for the redeploy (bounded, individually short polls) before reviewing.
6. `releaseId` equal to `unknown` (or `HEAD` from a Coolify preview bug) →
   call it **unverified**, not ready.

If the deployment wiring prevents the match, that is the real remaining
blocker for #75-style preview review — treat it as such rather than claiming
success because a preview is reachable.

When a PR is backend- or UI-relevant, probe its actual preview hostname
(`curl -sI https://pr-<n>.runespace.qcfailed.com`) and report the real result in
the PR body rather than treating a deployment comment alone as reachability
evidence.

### Preview test-data discipline

For manual PR-preview review:

- use clearly disposable test accounts/characters with recognizable unique
  suffixes (for example a `review-<date>-<initials>` prefix);
- never use production-like personal data;
- assume preview-created data may survive application redeploys;
- record temporary review identities when useful to later cleanup/debugging;
- remove disposable data only through a known safe supported path when
  practical;
- never use broad SQL/delete/reset commands merely to make a preview "clean";
- never run preview cleanup logic against production.

This issue deliberately adds **no** reset-all/delete-all utility. Automated
preview-data lifecycle is out of scope for #75.

### QC Failed status manifest

`.qcfailed/status.json` remains in place only because qcfailed.com's Build Floor
still reads it; qcfailed.com issue #22 replaces that consumer, after which the
manifest is retired in a separate RuneSpace change. Until then agents make no
routine or status-only manifest updates and edit it only when an issue or the
product owner asks. `pnpm test` keeps it parseable and within its public-safe
contract through `tests/unit/qcfailed-status.test.ts`.

### CI and the merge gate

The `CI` workflow runs the same full validation for every PR opening, reopening,
and push — Draft or not — and for every push to `main`. Its lanes — five jobs —
start together, each with its own checkout, runner, and (where needed)
PostgreSQL service; none waits for or consumes another:

- `Install, typecheck, lint, test, build` (frozen install, typecheck of the app
  and every test including `tests/e2e`, lint, format check, unit tests, and one
  production build);
- `PostgreSQL integration tests`;
- `Canonical E2E shard 1/3`, `2/3`, and `3/3`.

`Merge gate` depends on every lane, runs even when one failed, was skipped, or
was canceled, and passes only when each required lane succeeded (`scripts/ci-merge-gate.mjs`).
Skipped never counts as success for a required lane, because GitHub would
otherwise report a skipped job as passing. The opt-in screenshot lane is part of
the gate only when requested: once it runs, it must succeed.

Adding the `e2e-screenshots` label starts a fresh full run for the same head that
also includes the one-worker screenshot lane; later pushes keep it while the
label remains. Any label event reruns the full validation, so a label-triggered
run can never leave a skipped, falsely passing `Merge gate` on the head. There
is no Ready-for-review step that changes CI, and the old `full-ci` label no
longer has any special effect.

A newer run for the same PR cancels the older one. `main` and manual
`workflow_dispatch` runs use unique concurrency groups and are never canceled by
PR activity. Check runs attach to the commit they validated, so a green result on
an older head never satisfies a newer one. `Merge gate` logs the PR head it
validated.

`main` currently has no branch protection or ruleset: on 2026-10-03 an
owner-authenticated read returned `Branch not protected` and an empty rulesets
list. If protection is enabled, require `Merge gate` (which covers every lane);
the individual lane names stay diagnostic. Treat that snapshot as dated and
re-verify before acting on it. Changing protection is an owner action.

Before requesting final review, follow every remote job to a terminal state.
After a correction, run focused checks for that correction and let the remote
full run repeat; do not repeat the complete local suite blindly after every
small fix.

## Self-review the diff
Before opening or updating the PR, inspect the final diff for scope,
duplication, premature abstraction, unjustified dependencies, accidental game
logic in UI, broken documentation links, and unsupported claims about repository
behavior.

## PR content
The PR must include:
- a clear summary of what changed
- the exact branch, PR, local validation results, and canonical CI status
- `closes #<issue number>` in the PR body for each delivered issue (only those
  whose done-criteria are met, in an approved bundle). The closing
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
- for instruction-policy or harness audits, the exact baseline/final size
  metrics, moved-content map, operating-ceiling rationale, harness evidence
  classification, sentinel-probe results, and unverified limitations

## Observe CI and deployment progress
Follow the PR's CI run to a terminal state: continue until every required job
reports success, or a genuine external blocker is precisely documented. Do not
treat an
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
self-review and document the review approach in the PR.
