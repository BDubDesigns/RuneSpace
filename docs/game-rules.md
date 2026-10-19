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
- **Welding & Cargo Hold** — ship Cargo Hold, Landing Gear (#322) and Propulsion System (#330) repair at Crash Site, the Crew Stop repair in Holo Hollow, and Welding progression.
- **Oil Shale Mining (#342)** — The South Cut, reached over the travel-only South Access Track, is Skatboll's Mining-5 Oil Shale source with a low-yield outcome, a Sapphire / ultra-rare Motherlode Slab secondary table, and the per-character Prioritize primary resources setting (`docs/gameplay-foundations.md`, "Oil Shale at The South Cut").
- **Site stashes** — a permanent per-character stash mount at The Jag, Rusk Recovery, the Abandoned Processing Yard and Deep Jag (#284), built through the ordinary Welding repair flow and gated only by personal Welding level, with any owned container installed to supply slots (`docs/gameplay-foundations.md`).
- **Practice Welding & Clean Pass** — the repeatable Welding training loop at Wade's Workbench in Rusk Recovery, run a chosen number of welds at a time or Max until the Scrap runs out, and the two optional Clean Pass opportunities every Welding work unit rolls (`docs/gameplay-foundations.md`).
- **Holo Hollow Landing and Last Leg Trading (#357)** — Skatboll's walkable landing pad at axial (1,1), joined to the Crash Site, the Abandoned Processing Yard and the South Access Track, with Toll Kade's shop as its one Local Place: three replayable Talk topics on foot, and a fuel counter that the server opens only for a character who has completed and reported Thrust Issues (`docs/gameplay-foundations.md`, "Completed-Mission merchant unlock and Last Leg Trading"). No ship state, flight or Stillreach.
- **The Rivet Utility Shuttle and its first flight (#358)** — one persistent ship per character with a berth and a 300 FU tank, loaded from Inventory or the attached Cargo Hold with Full Small Fuel Canisters; the single Ship panel at its berth; Wade's Move Along (started by the Thrust Issues report, completed by the flight's own landing, no reward); a 15-second, 10 FU authoritative flight from the Crash Site to Holo Hollow Landing that lands lazily and offline-safely, moves the character, ship and Cargo Hold together, and leaves a durable dismissible arrival notice. No return flight and no Stillreach route (`docs/gameplay-foundations.md`, "The Rivet Utility Shuttle and its first flight").
- **Fuel manufacturing (#343)** — the Empty Small Fuel Canister (Fabrication 8, 1 Galvanic Stock) and the Full Small Fuel Canister (Refining 8, 10 Oil Shale + 1 Empty canister, a failure returning 5 shale and the shell, 50 Fuel Units): two ordinary tradable stackable items on the existing engines. The Rivet loads them into its tank (#358; see "The Rivet Utility Shuttle" below) (`docs/gameplay-foundations.md`, "Fuel manufacturing").
- **Rune materials (#367)** — Rune Fragments (200 g, stack 10) are a Mining Secondary Find at The Jag (1 in 25), Deep Jag (1 in 8) and The South Cut (1 in 6), worth +20 Mining XP, and the intact Runestone (1,000 g, stack 5) breaks apart from Inventory Item Details into exactly five Fragments; Runestones have no natural source yet (`docs/gameplay-foundations.md`, "Rune materials").
- **Fabrication & Tinkering** — Fabrication at Rusk Recovery's Fabrication Station: the four Tier-1 recipes (#232), Fabrication 5's Direct Galvanic Scrap, Galvanic Wire Spool, two-Cell Power Cell batch, Loadsteel Cutter and Wheel Assembly (#322), and Fabrication 8's Drive Mount (#330), Freight Harness (#233) and Empty Small Fuel Canister (#343); a binding workpiece whose materials stay reserved until it resolves, numeric or Max runs, the optional Manual Override push-your-luck layer, and Tinkering — dismantling finished Fabrication output for Fabrication XP and Scrap Metal (`docs/gameplay-foundations.md`).
- **Inventory & Equipment** — carried stacks/unique items, slot/mass capacity, containers (the starter MYKEA and the fabricated Scrap Box and Freight Harness), two Mining tools (the Salvage Cutter and the Mining 5 Loadsteel Cutter), and Equipment, all resolved through one authored equipment-definition boundary (#233).
- **Locations & presentation** — location scenes and the local world map.
- **Holo Hollow, Local Places & Credits** — the first settlement, one-level Local Places inside it, character-scoped Credits, and Bix's authored merchant Trade (`docs/gameplay-foundations.md`, `docs/holo-hollow.md`).
- **Missions & NPC conversations** — declarative mission framework (`docs/missions.md`), authored missions (Walk It Off / Cut Your Teeth / Waste Not / Hold It Together / Keep the Change / 10,000 Hours / 10,001 Hours / Return the Favor / Break It Down / Brace Yourself / Wheel Be Right Back / Thrust Issues / Move Along / A Cut Above, plus the optional Out of the Weather, Cutting Costs and Curly Must-Stash), the one canonical NPC conversation model with replayable topics (`docs/npc-conversations.md`), and dialogue authoring (`docs/qc-studio.md`).

## World & skills

- The opening direction is a **one-way crash-site tutorial planet**.
- **Mining** is the first core skill direction; **Refining** is the second (at the Abandoned Processing Yard); **Welding** repairs the crashed ship's Cargo Hold at Crash Site, and is practised, as often as the player likes, at Wade's Workbench in Rusk Recovery; **Fabrication** turns processed stock into discrete items at the Fabrication Station beside that bench, taught by Tansy after 10,000 Hours.
- Planetary maps use **hexes** with **local fog-of-war** exploration.
- **Explore** consumes **limited fuel**. The Rivet's first flight (#358) is the first fuel spend: 10 Fuel Units for the Crash Site to Holo Hollow Landing hop.
- **Speeder Piloting** and **Ship Piloting** are separate skill directions.

## Content & validation

- Game content should be **data-driven** and **validated** (Zod schemas in `game/schemas/`, typed definitions in `game/content/`).
- Content is referenced by **stable IDs** (see `game/schemas/ids.ts`), never by inline literals in UI code.

## Non-goals (currently)

The following remain explicitly out of scope until later approved issues: additional quest/mission content beyond the current authored missions, additional crafting/gathering activities beyond the approved Mining/Refining/Welding/Fabrication slices (Fabrication beyond its level-8 Freight Harness, landing-gear repair, site-stash electronics and remote manifests, original-material Tinkering recovery, and further tool tiers are future work), hex exploration, fuel consumption beyond the approved Cargo Hold repair, ships/speeders, combat, Phaser minigames, chat/clans/multiplayer, player-to-player trading and any player-driven market or economy simulation, a CMS, background workers, and autonomous issue selection. See `docs/gameplay-foundations.md` for the authoritative slice boundaries.

The approved NPC merchant loop (Credits and Bix's fixed buy/sell catalog, issue
#159) is live and described in `docs/gameplay-foundations.md` and
`docs/holo-hollow.md`. It is deliberately not a market: prices are authored
content, stock is fixed, and no merchant wallet, restock timer, dynamic pricing,
or player-to-player exchange exists.
