# game/domain

Pure game rules, calculations, state transitions, IDs, and shared contracts.

Rules here must be:

- framework-free (no React, no Next.js, no `pg`)
- deterministic and side-effect free where possible
- the single source of truth for any computed value

Real domain logic (XP curves, fuel costs, travel rules, inventory rules, quest
requirements) arrives in later issues. Nothing here should invent balance
values, content, or mechanics. See `docs/architecture.md`.
