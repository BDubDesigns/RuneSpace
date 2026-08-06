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

### Selectable-category rule (issue #65)

Exactly the ten `player-starter` entries are selectable by players. `npc-only`
and `reserved` portraits remain valid production assets but never appear in
the picker, selection payloads, or validation allowlists. Availability is this
catalog's category metadata — never filenames or folder separation. Future
approved selectable portraits are added by reclassifying or adding catalog
entries, not by touching validation or UI code. The neutral system placeholder
used for legacy/null characters is deliberately not a catalog portrait.
