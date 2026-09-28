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
- **Refining** — authored recipes at the Abandoned Processing Yard, run a chosen number of batches at a time, or Max until blocked (bounded runs, #229).
- **Welding & Cargo Hold** — ship Cargo Hold repair at Crash Site, the Crew Stop repair in Holo Hollow, and Welding progression.
- **Practice Welding & Clean Pass** — the repeatable Welding training loop at Wade's Workbench in Rusk Recovery, run a chosen number of welds at a time or Max until the Scrap runs out, and the two optional Clean Pass opportunities every Welding work unit rolls (`docs/gameplay-foundations.md`).
- **Fabrication & Tinkering** — Fabrication at Rusk Recovery's Fabrication Station: the four Tier-1 recipes (#232), Fabrication 5's Direct Galvanic Scrap, Galvanic Wire Spool, two-Cell Power Cell batch and Loadsteel Cutter, and Fabrication 8's Freight Harness (#233); a binding workpiece whose materials stay reserved until it resolves, numeric or Max runs, the optional Manual Override push-your-luck layer, and Tinkering — dismantling finished Fabrication output for Fabrication XP and Scrap Metal (`docs/gameplay-foundations.md`).
- **Inventory & Equipment** — carried stacks/unique items, slot/mass capacity, containers (the starter MYKEA and the fabricated Scrap Box and Freight Harness), two Mining tools (the Salvage Cutter and the Mining 5 Loadsteel Cutter), and Equipment, all resolved through one authored equipment-definition boundary (#233).
- **Locations & presentation** — location scenes and the local world map.
- **Holo Hollow, Local Places & Credits** — the first settlement, one-level Local Places inside it, character-scoped Credits, and Bix's authored merchant Trade (`docs/gameplay-foundations.md`, `docs/holo-hollow.md`).
- **Missions & NPC conversations** — declarative mission framework (`docs/missions.md`), authored missions (Walk It Off / Cut Your Teeth / Waste Not / Hold It Together / Keep the Change / 10,000 Hours / 10,001 Hours / Return the Favor / Break It Down / Brace Yourself / A Cut Above, plus the optional Out of the Weather and Cutting Costs), the one canonical NPC conversation model with replayable topics (`docs/npc-conversations.md`), and dialogue authoring (`docs/qc-studio.md`).

## World & skills

- The opening direction is a **one-way crash-site tutorial planet**.
- **Mining** is the first core skill direction; **Refining** is the second (at the Abandoned Processing Yard); **Welding** repairs the crashed ship's Cargo Hold at Crash Site, and is practised, as often as the player likes, at Wade's Workbench in Rusk Recovery; **Fabrication** turns processed stock into discrete items at the Fabrication Station beside that bench, taught by Tansy after 10,000 Hours.
- Planetary maps use **hexes** with **local fog-of-war** exploration.
- **Explore** consumes **limited fuel**.
- **Speeder Piloting** and **Ship Piloting** are separate skill directions.

## Content & validation

- Game content should be **data-driven** and **validated** (Zod schemas in `game/schemas/`, typed definitions in `game/content/`).
- Content is referenced by **stable IDs** (see `game/schemas/ids.ts`), never by inline literals in UI code.

## Non-goals (currently)

The following remain explicitly out of scope until later approved issues: additional quest/mission content beyond the current authored missions, additional crafting/gathering activities beyond the approved Mining/Refining/Welding/Fabrication slices (Fabrication beyond its level-8 Freight Harness, landing-gear repair, player-built site storage, original-material Tinkering recovery, and further tool tiers are future work), hex exploration, fuel consumption beyond the approved Cargo Hold repair, ships/speeders, combat, Phaser minigames, chat/clans/multiplayer, player-to-player trading and any player-driven market or economy simulation, a CMS, background workers, and autonomous issue selection. See `docs/gameplay-foundations.md` for the authoritative slice boundaries.

The approved NPC merchant loop (Credits and Bix's fixed buy/sell catalog, issue
#159) is live and described in `docs/gameplay-foundations.md` and
`docs/holo-hollow.md`. It is deliberately not a market: prices are authored
content, stock is fixed, and no merchant wallet, restock timer, dynamic pricing,
or player-to-player exchange exists.
