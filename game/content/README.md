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
typed validated API (`PORTRAITS`, `PLAYER_STARTER_PORTRAITS`,
`PLAYER_UNLOCKABLE_PORTRAITS`, `getPortrait`).
Stable IDs are registered in `game/config/foundations.ts` (`PORTRAIT_IDS`).
Issue #65 consumes this catalog; it must not re-sort or re-classify the assets.

### Selectable-category rule (issue #65)

The ten `player-starter` entries are always selectable. The
`player-unlockable` entries are selectable only for accounts that own the
corresponding permanent entitlement; the shared player-aware portrait domain
rule projects that account context for the picker, creation, edits, and safe
presentation. `npc-only` and `reserved` portraits remain valid production
assets but never become selectable. Availability is this catalog's category
metadata plus the server-loaded ownership set — never filenames or folder
separation. Future approved unlockables are added by catalog metadata and the
same entitlement boundary, not by duplicating validation or UI rules. The
neutral system placeholder used for legacy/null/unavailable characters is
deliberately not a catalog portrait.
