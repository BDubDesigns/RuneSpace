# game/content

Typed content definitions for locations, items, quests, actions, requirements,
rewards, and progression data.

Content here is data-driven and validated (see `game/schemas/`). It is referenced
by stable IDs from `game/schemas/ids.ts`, never by inline literals in UI code.

Issue #16 establishes approved stable IDs only; typed item definitions and their
balance values arrive later. Nothing here should invent lore, NPCs, quests,
resources, or balance values. See `docs/gameplay-foundations.md`.

## Portrait catalog (issue #70)

`portrait-catalog.json` is the machine-readable single source of truth for the
accepted character portrait library (stable IDs, display names, launch
categories, master and derivative paths); `portrait-catalog.ts` exposes the
typed validated API (`PORTRAITS`, `PLAYER_STARTER_PORTRAITS`, `getPortrait`).
Stable IDs are registered in `game/config/foundations.ts` (`PORTRAIT_IDS`).
Issue #65 consumes this catalog; it must not re-sort or re-classify the assets.
