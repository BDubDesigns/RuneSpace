# Skill XP artwork master

Retained source master for the owner-approved circular industrial XP medallion
(issue #304). This directory is deliberately outside `public/` and is never
imported by application code or served to clients; the Docker build context
excludes the whole `assets` directory.

- `xp-medallion-master.png` is the owner-supplied 1254×1254 transparent render,
  committed byte-for-byte (SHA-256
  `6ee6ce6b25f65274decbe12af437944749d01e544997b764329a9a04a59ecd2b`). Nothing
  was regenerated, recomposed or recoloured.
- `public/xp/xp-medallion.webp` is the only raster the application consumes: the
  master cropped to its visible bounds (alpha ≥ 16, 1153×1166), padded with
  transparency to a square, resized to 320×320, and encoded as WebP at quality 90
  with lossless alpha (`alphaQuality: 100`, `effort: 6`), 47 KB. 320 px is 4× the
  80 px reward-tile artwork zone, which covers a 3× phone display. It was checked
  on dark, white and saturated magenta backgrounds for fringing, and at 80 px for
  legibility of the XP mark and chevrons.

XP is a skill-specific progression figure, never an inventory item or currency.
One neutral medallion is used for every skill; the surrounding tile owns the
skill name and accent. The inline XP treatment is real text
(`components/ui/XpAmount.tsx`), not this raster.
