# Development Workflow

Follow `AGENTS.md` for the normative architecture, scope, and agent-behavior
contract. This document provides the supporting procedure.

## One issue, one branch, one draft PR
- Fetch `origin`, then create each dedicated branch from the latest `origin/main`.
- Produce **one draft pull request** per issue. Do not open multiple PRs for the
  same issue.
- Work stops at a draft PR for human review. Do not merge unless the product owner
  explicitly instructs it to merge after review.

## Validate locally

### Managed RuneSpace host
On Brandon's managed RuneSpace host, load the private environment before every
database-backed command. Do not print its contents. It supplies the host-local
`DATABASE_URL`; do not replace it with Docker example credentials.

```bash
cd /home/brandon/workspace/projects/runespace
source /home/brandon/.config/runespace/dev.env
export PATH="/usr/bin:$PATH"
node --version # Must report 22.x

pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm drizzle-kit migrate
pnpm test:integration
pnpm build
pnpm test:e2e:canonical
```

If `/home/brandon/.config/runespace/dev.env` is missing or unreadable, stop and
report the environment blocker. Never guess credentials, inspect or report the
private file's contents, or use the Coolify production database for local testing.
The canonical runner's localhost-only database safety check remains authoritative.

### Generic fresh clone or Docker Compose setup
For a separately created generic local Docker database, `.env.example` contains
example Docker Compose credentials. Those credentials apply only to that Docker
database after it has been created; they must not override a managed host's
private environment.

Run affected focused checks when their required environment is available. For
example, integration tests require PostgreSQL and browser tests require the
Playwright browser dependencies and their database setup.

Canonical CI also runs PostgreSQL integration tests and the canonical E2E
browser-journey job (Mining, Overlay, Travel, and the repeated Mining
play-boundary check). A local skip or unavailable environment is not a pass:
report it as unexecuted and wait for the corresponding canonical CI result.

## Self-review the diff
Before opening or updating the draft PR, inspect the final diff for scope,
duplication, premature abstraction, unjustified dependencies, accidental game
logic in UI, broken documentation links, and unsupported claims about repository
behavior.

## Draft PR content
The PR must include:
- a clear summary of what changed
- the exact branch, PR, local validation results, and canonical CI status
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
blocker is precisely documented. Do not treat an in-progress job as a pass, and
do not claim canonical CI is green until it actually reports success. A docs-only
change may be *described* as unable to introduce an application- or test-code
regression — which explains why you might prioritize other work while it runs —
but that description is not a substitute for the green result.

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
