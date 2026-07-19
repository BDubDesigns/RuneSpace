# RuneSpace Issue Workflow

RuneSpace uses a harness-neutral workflow for one approved GitHub issue at a
time. The active model implements the issue; no project-local subagents, model
profiles, or external orchestration scripts are required.

## Workflow

1. Read the issue, `AGENTS.md`, relevant `docs/`, code, tests, and CI workflow.
2. Create one branch from `main`, write a bounded plan, and implement only the
   issue acceptance criteria.
3. Preserve the architecture boundaries and SSOT rules in `AGENTS.md`. Do not
   invent gameplay, content, lore, balance, or architecture.
4. Run the CI-parity commands in `docs/development-workflow.md`, including the
   build environment required by `.github/workflows/ci.yml`.
5. Self-review the final diff for scope, duplication, extraction, abstractions,
   dependencies, and server-authoritative gameplay boundaries.
6. For hard reasoning or final review, request a separate model pass when
   available. OpenCode users may switch models manually. If delegation is not
   available, do not block ordinary work: record a careful self-review instead.
7. Push one branch and open or update one draft PR with the commands and results,
   architectural decisions, review approach, unresolved questions, and confirmation
   that no gameplay was implemented. Inspect remote CI when available.
8. Stop for human review. Never merge your own work or begin another issue.

This document and `AGENTS.md` are the repository workflow authority.
