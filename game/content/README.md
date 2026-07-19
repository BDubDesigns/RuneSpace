# game/content

Typed content definitions for locations, items, quests, actions, requirements,
rewards, and progression data.

Content here is data-driven and validated (see `game/schemas/`). It is referenced
by stable IDs from `game/schemas/ids.ts`, never by inline literals in UI code.

Issue #16 establishes approved stable IDs only; typed item definitions and their
balance values arrive later. Nothing here should invent lore, NPCs, quests,
resources, or balance values. See `docs/gameplay-foundations.md`.
