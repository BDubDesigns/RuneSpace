# Character Portrait Asset Inventory (issue #70)

Review evidence for the curated, classified, and optimized portrait library.
Stable portrait IDs are code-owned in `game/config/foundations.ts`
(`PORTRAIT_IDS`, the repository's identity convention); the machine-readable
content catalog `game/content/portrait-catalog.json` references those IDs
(asserted at import) and carries all presentation, category, and asset-path
metadata. This document is the human-readable inventory with exact sizes and
decisions. Review the labeled contact sheet at
`docs/assets/portrait-contact-sheet.png` alongside this inventory.

## Summary

- **Staged files:** 25 root-level `file_*.png` (all 1254×1254, 8-bit RGB PNG).
- **Accepted:** 25 — every staged image was visually inspected (pixel-level
  review, not filenames) and accepted. **Rejected/superseded: 0** — no exact or
  near duplicates, no malformed faces/hands, no severe seams, no corrupt files,
  no accidental screenshots/UI captures, and no non-portrait files were found.
- **player-starter (10):** EVA Salvage Welder, Cargo Pilot, Orbital Botanist,
  Station Captain, Frontier Medic, Zero-G Rock Star, Gramma, Grampa, Zero-G
  Gymnast, Space Nerd.
- **npc-only (2):** Baker, Milkman (related-brother NPC pair, approved).
- **reserved (13):** all other accepted portraits.
- **Masters:** 64,334,950 bytes (61.35 MiB) in `assets/character-portraits/`
  (outside `public/`, outside any application-imported path).
- **Derivatives:** 1,118,340 bytes (1.07 MiB) in `public/character-portraits/`
  as committed 512×512 WebP quality 80 — a **98.26% reduction** (64.3 MiB →
  1.1 MiB; 2.37–2.94 MiB per PNG → 35.2–55.2 KiB per WebP).
- **Staging cleanup:** all 25 opaque root-level `file_*.png` files and the
  leftover `portrait-staging/Temp` placeholder were removed from the final tree.

## Canonical structure

```text
assets/character-portraits/      canonical high-resolution masters (1254×1254 PNG)
  └─ portrait-<concept>-01.png   never served, never imported, excluded from Docker context
public/character-portraits/      committed optimized production derivatives (512×512 WebP q80)
  └─ portrait-<concept>-01.webp  the only portrait assets the application consumes
game/content/portrait-catalog.json   machine-readable content catalog (IDs reference PORTRAIT_IDS)
game/content/portrait-catalog.ts     typed validated API (PORTRAITS, PLAYER_STARTER_PORTRAITS, getPortrait)
game/schemas/portraits.ts            Zod validation contract
docs/assets/portrait-contact-sheet.png   labeled review contact sheet (evidence only, not a catalog entry)
```

Derivative decision: one consistent square production dimension (**512×512**)
and format (**WebP, quality 80**), chosen for profile cards and the Issue #65
picker rendered through `next/image` (typical 96–170 px render targets cover
roughly 3× DPR). No crop/object-position metadata is needed: all accepted
masters are already square full-frame compositions. Masters keep their 1254×1254
PNG form as the future-art-work source; derivatives are committed before CI and
deployment and are never regenerated at build, startup, or request time.

## Per-portrait inventory

All masters are 1254×1254 PNG; all derivatives are 512×512 WebP quality 80.
Staging source names are the opaque root-level upload filenames.

| Stable ID | Display name | Category | Staging source | Master bytes | Derivative bytes |
| --- | --- | --- | --- | --- | --- |
| portrait_eva_salvage_welder_01 | EVA Salvage Welder | player-starter | file_...be8c... | 2,618,024 | 42,986 |
| portrait_cargo_pilot_01 | Cargo Pilot | player-starter | file_...7c20... | 2,663,566 | 48,244 |
| portrait_orbital_botanist_01 | Orbital Botanist | player-starter | file_...8438... | 2,565,906 | 45,040 |
| portrait_station_captain_01 | Station Captain | player-starter | file_...232c... | 2,558,355 | 38,272 |
| portrait_frontier_medic_01 | Frontier Medic | player-starter | file_...2f18... | 2,686,682 | 46,684 |
| portrait_zero_g_rock_star_01 | Zero-G Rock Star | player-starter | file_...f474... | 2,940,060 | 55,098 |
| portrait_gramma_01 | Gramma | player-starter | file_...686c... | 2,380,540 | 39,254 |
| portrait_grampa_01 | Grampa | player-starter | file_...2f58... | 2,409,761 | 40,648 |
| portrait_zero_g_gymnast_01 | Zero-G Gymnast | player-starter | file_...7c74... | 2,369,099 | 43,678 |
| portrait_space_nerd_01 | Space Nerd | player-starter | file_...1bd4... | 2,414,994 | 43,044 |
| portrait_baker_01 | Baker | npc-only | file_...5124... | 2,818,283 | 51,288 |
| portrait_milkman_01 | Milkman | npc-only | file_...f688... | 2,617,654 | 42,968 |
| portrait_banana_mechanic_01 | Banana Mechanic | reserved | file_...1624... | 2,741,158 | 51,712 |
| portrait_child_inventor_01 | Child Inventor | reserved | file_...21d8... | 2,490,915 | 42,110 |
| portrait_chocolate_snack_thief_01 | Chocolate Snack Thief | reserved | file_...aea8... | 2,502,880 | 43,784 |
| portrait_eccentric_scientist_01 | Eccentric Scientist | reserved | file_...a7dc... | 2,536,400 | 40,938 |
| portrait_radio_host_01 | Radio Host | reserved | file_...6d28... | 2,686,288 | 46,376 |
| portrait_military_medic_01 | Military Medic | reserved | file_...f5d0... | 2,488,216 | 36,216 |
| portrait_sloth_maintenance_01 | Sloth Maintenance | reserved | file_...bf38... | 2,533,922 | 49,478 |
| portrait_space_footballer_01 | Space Footballer | reserved | file_...8b48... | 2,433,385 | 37,352 |
| portrait_spaceport_courier_01 | Spaceport Courier | reserved | file_...c64c... | 2,549,979 | 45,346 |
| portrait_tea_psychic_01 | Tea Psychic | reserved | file_...126c... | 2,467,552 | 45,716 |
| portrait_unicorn_mechanic_01 | Unicorn Mechanic | reserved | file_...9af0... | 2,762,233 | 55,162 |
| portrait_von_scavenger_01 | Von Scavenger | reserved | file_...8d44... | 2,654,446 | 43,512 |
| portrait_zero_g_ballerina_01 | Zero-G Ballerina | reserved | file_...7c1c... | 2,444,652 | 43,434 |
| **Totals** | | | | **64,334,950** | **1,118,340** |

## Classification decisions

- **Gramma = file_...686c...**: the pixel review found two elderly women. The
  chosen portrait literally wears a chest label reading "GRAMMA" (and a "BEST
  GRAMMA IN THE VERSE" mug) and is the workshop-mechanic figure pairing with
  the "GRAMPA"-labeled mechanic. The other elderly woman
  (file_...126c..., lavender hair, "Spilln Truth" tea room) is a distinct
  accepted concept classified `reserved` as "Tea Psychic".
- **Frontier Medic = file_...2f18...**: the female medic presents the rustic
  frontier-field look (brown harness, improvised gear, treatment bay) matching
  the approved "frontier medic" concept; the male medic (file_...f5d0...) wears
  institutional navy uniform with military triage/evac signage and is a distinct
  accepted concept classified `reserved` as "Military Medic".
- **Baker/Milkman**: file_...5124... (white baker cap, flour, bread) and
  file_...f688... (white-and-blue milkman uniform, milk crates) intentionally
  resemble each other as the approved related NPC pair; this is not treated as a
  duplicate.
- **Named-persona exception**: Von Scavenger (file_...8d44...) is classified
  `reserved` under the issue's approved named-persona allowance.
- No duplicate or superseded generations exist in the staging set; every staged
  file maps to one distinct accepted concept, so nothing was rejected.

## Default-portrait candidates

The product owner will choose the single default portrait before Issue #65
persists selections; this issue does not set a default. Viable candidates based
on the inspected portraits: **Gramma** (friendly mechanic archetype matching the
starter workshop theme), **Grampa** (same pairing), or **Station Captain**
(neutral authority figure). These are suggestions for the owner's decision, not
a selection.

## Tooling and regeneration

`scripts/optimize-portraits.mjs` performs the deterministic repository-side
optimization (downscale 1254² → 512², WebP q80, high-quality smoothing, contact
sheet render) using the already-installed Playwright Chromium (devDependency,
@playwright/test 1.51.1). Derivatives are committed; the script exists for
reproducibility and must not be run during `next build`, Docker build, startup,
or request time. If a future agent regenerates, record the Playwright/Chromium
version and new byte sizes in the PR.

## Validation and delivery boundaries

- Masters are excluded from the Docker build context by the narrow
  `.dockerignore` rule `assets/character-portraits`; the Dockerfile asserts the
  directory is absent after `COPY . .`. The live Coolify deployment uses
  Nixpacks (not the Dockerfile), which copies the application directory —
  masters therefore remain in the Nixpacks runtime filesystem but are never
  HTTP-served (Next.js serves only `public/`) and are never imported by code.
- `tests/unit/portrait-catalog.test.ts` proves: catalog/registry ID parity and
  unique identities and paths, exactly the ten approved starter identities in
  approved picker order, baker/milkman as the only npc-only portraits,
  starter-only selection helpers, the neutral canonical ID/filename format
  (concept-first naming itself is a documentation and human-review policy, not
  a regex), categories absent from asset paths, masters outside `public/` and
  derivatives under the canonical public path, expected derivative metadata and
  accessible descriptions, and exact catalog-to-filesystem parity with no
  missing or orphan assets.
- No selection UI, persistence, NPC system, quest, unlock, purchase, or generic
  cosmetics framework is added; Issue #65 consumes this catalog.
