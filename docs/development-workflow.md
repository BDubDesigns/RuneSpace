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
Baseline local checks mirror the fast CI job:
```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
DATABASE_URL=postgres://runespace:runespace@localhost:5432/runespace \
  NODE_ENV=production \
  BETTER_AUTH_SECRET=insecure-ci-build-only-secret-do-not-use-in-prod-0000000000 \
  BETTER_AUTH_URL=http://localhost:3000 \
  RUNESPACE_RELEASE_ID=local \
  pnpm build
```

Run affected focused checks when their required environment is available. For
example, integration tests require PostgreSQL and browser tests require the
Playwright browser dependencies and their database setup.

Canonical CI also runs PostgreSQL integration tests and the focused Mining
Playwright journey. A local skip or unavailable environment is not a pass: report
it as unexecuted and wait for the corresponding canonical CI result.

## Self-review the diff
Before opening or updating the draft PR, inspect the final diff for scope,
duplication, premature abstraction, unjustified dependencies, accidental game
logic in UI, broken documentation links, and unsupported claims about repository
behavior.

## Draft PR content
The PR must include:
- a clear summary of what changed
- the exact branch, commit, PR, local validation results, canonical CI status,
  and required artifact evidence
- screenshots at narrow mobile and desktop widths for UI issues
- key architectural decisions, review approach, and unresolved questions or
  limitations
- whether gameplay, balance, persistence, or player-facing behavior changed and
  the approved decisions governing any such change

## Follow canonical CI
Keep the PR draft while canonical CI completes. If a job fails, inspect the
failed job and step logs, fix relevant failures on the same branch, push the fix,
and wait for the replacement run. Report genuine external blockers precisely;
record optional improvements separately.

## Model-assisted review
For difficult reasoning or final review, use a separate model pass when the
active harness supports it. Manual model switching in OpenCode is allowed.
Unavailable delegation must not block ordinary issue work: complete a careful
self-review and document the review approach in the draft PR.
