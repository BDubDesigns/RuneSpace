# game/domain

Pure game rules, calculations, state transitions, IDs, and shared contracts.

Rules here must be:

- framework-free (no React, no Next.js, no `pg`)
- deterministic and side-effect free where possible
- the single source of truth for any computed value

Foundational timing, progression, and inventory contracts live here. Final XP
curves, activity values, fuel costs, travel rules, and quests remain later work.
Nothing here should invent balance values, content, or mechanics. See
`docs/gameplay-foundations.md`.
