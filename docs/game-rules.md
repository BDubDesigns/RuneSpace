# Game Rules (current design direction)

> **This document records stable current design direction. It distinguishes implemented/current systems, approved direction not yet implemented, and explicitly future/out-of-scope work.** For detailed contracts see the linked authoritative docs — this document does not duplicate their full mechanics or balance values.

## Platform

- RuneSpace is **browser-first** and **mobile-friendly**.
- It is a low-fi sci-fi RPG inspired by the progression, quests, social texture, and long-term grind of old-school MMORPGs and action-point games. It is **not** a RuneScape clone.

## Progression

- **Progression is central** to the experience.
- Active play may be **more efficient** than passive/offline play.
- Passive/offline systems, if any, must be **explicit and server-resolved**. The client never computes offline gains.
- **Botting is forbidden.** Any authorized automation must be an in-world system introduced later, not client-side scripting.
- Authoritative timing, action resolution, inventory, and XP contracts are in `docs/gameplay-foundations.md`.

## Implemented early-game systems

The following are live on `main` as server-authoritative, Play-orchestrated systems (see `docs/gameplay-foundations.md`, `docs/missions.md`, and `docs/location-scenes.md` for detailed contracts):

- **Play orchestration** — generic transaction/action lifecycle, shared state assembly, and client Play shell (`server/action-resolution.ts`, `server/play.ts`, `features/play/`).
- **Travel & Scavenging** — walking between locations, scavenging yields, and Power Annex / Power Cell claims.
- **Mining** — Ferrite Shale Mining at The Jag (Power Cell boosting, run history).
- **Refining** — Ferrite Shale refining at the Abandoned Processing Yard.
- **Welding & Cargo Hold** — ship Cargo Hold repair at Crash Site and Welding progression.
- **Inventory & Equipment** — carried stacks/unique items, slot/mass capacity, containers, and Equipment.
- **Locations & presentation** — location scenes and the local world map.
- **Missions & NPC interactions** — declarative mission framework (`docs/missions.md`), authored missions (Walk It Off / Cut Your Teeth), and NPC dialogue/interaction (`docs/qc-studio.md` for authoring).

## World & skills

- The opening direction is a **one-way crash-site tutorial planet**.
- **Mining** is the first core skill direction; **Refining** is the second (at the Abandoned Processing Yard); **Welding** repairs the crashed ship's Cargo Hold at Crash Site.
- Planetary maps use **hexes** with **local fog-of-war** exploration.
- **Explore** consumes **limited fuel**.
- **Speeder Piloting** and **Ship Piloting** are separate skill directions.

## Content & validation

- Game content should be **data-driven** and **validated** (Zod schemas in `game/schemas/`, typed definitions in `game/content/`).
- Content is referenced by **stable IDs** (see `game/schemas/ids.ts`), never by inline literals in UI code.

## Non-goals (currently)

The following remain explicitly out of scope until later approved issues: additional quest/mission content beyond the current authored missions, additional crafting/gathering activities beyond the approved Mining/Refining/Welding slices, hex exploration, fuel consumption beyond the approved Cargo Hold repair, ships/speeders, combat, Phaser minigames, chat/clans/multiplayer/economy/trading, a CMS, background workers, and autonomous issue selection. See `docs/gameplay-foundations.md` for the authoritative slice boundaries.
