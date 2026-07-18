# Development Workflow

## One issue, one branch, one draft PR
- Each issue is worked on a **dedicated branch** created from `main`.
- Produce **one draft pull request** per issue. Do not open multiple PRs for the
  same issue.
- **Never merge your own work.** Stop at the draft PR for human review.

## Inspect before implementation
- Read `AGENTS.md` and the relevant `docs/` for the area you will touch.
- Inspect existing code. Search for an existing component, domain rule, schema,
  or helper before adding a new one.
- Plan from the **actual repository state**, not assumptions.

## Implement only acceptance criteria
- Implement only what the issue's acceptance criteria require.
- Do not invent gameplay, lore, balance values, content, or architecture.
- Do not perform unrelated cleanup or scope expansion.

## Run checks before completion
Required local checks:
```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
# optional, local only:
pnpm test:e2e
```

## Self-review the diff
Before opening/updating the draft PR, inspect the final diff and explicitly
report:
1. any unnecessarily duplicated rule, identifier, config value, or doc statement
2. any component or module that should have been extracted
3. any abstraction introduced without a second real use case
4. any game logic that accidentally entered UI code
5. any dependency without a concrete justification
6. whether the implementation exceeded the issue's scope
7. whether all checks pass

## Draft PR content
The PR must include:
- a clear summary of what changed
- exact commands run and their results
- screenshots at narrow mobile and desktop widths (for UI issues)
- key architectural decisions
- unresolved questions, limitations, or version mismatches
- confirmation that no gameplay was implemented

## Future multi-agent workflow
These rules are designed so a future OpenHands Foreman / Reviewer / sub-agent
orchestration can build on them (see issue #2). The foundation does not implement
that orchestration itself.
