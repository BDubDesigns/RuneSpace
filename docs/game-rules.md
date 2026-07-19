# Game Rules (current design direction)

> **This document records stable current design direction only. It does NOT
> define the full game and establishes NO balance values, lore, NPCs, quests,
> resources, or mechanics.** Those are future issues. Nothing here is
> implemented outside the server-authoritative foundations documented in
> `docs/gameplay-foundations.md`.

## Platform
- RuneSpace is **browser-first** and **mobile-friendly**.
- It is a low-fi sci-fi RPG inspired by the progression, quests, social texture,
  and long-term grind of old-school MMORPGs and action-point games. It is **not**
  a RuneScape clone.

## Progression
- **Progression is central** to the experience.
- Active play may be **more efficient** than passive/offline play.
- Passive/offline systems, if any, must be **explicit and server-resolved**. The
  client never computes offline gains.
- **Botting is forbidden.** Any authorized automation must be an in-world system
  introduced later, not client-side scripting.
- Authoritative timing, action resolution, inventory, and XP contracts are in
  `docs/gameplay-foundations.md`.

## World & skills (directions, not implementations)
- The opening direction is a **one-way crash-site tutorial planet**.
- **Mining** is the first core skill direction; **Welding** follows.
- Planetary maps use **hexes** with **local fog-of-war** exploration.
- **Explore** consumes **limited fuel**.
- **Speeder Piloting** and **Ship Piloting** are separate skill directions.

## Content & validation
- Game content should be **data-driven** and **validated** (Zod schemas in
  `game/schemas/`, typed definitions in `game/content/`).
- Content is referenced by **stable IDs** (see `game/schemas/ids.ts`), never by
  inline literals in UI code.

## Non-goals (currently)
Tutorial gameplay, hex exploration, fuel consumption, playable Mining/Welding,
quests, ships/speeders, combat, Phaser minigames, chat/clans/multiplayer/economy/
trading, a CMS, background workers, and autonomous issue selection remain out of
scope until later issues.
