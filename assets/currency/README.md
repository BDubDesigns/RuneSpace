# Credits artwork master

Retained source master for the owner-approved battered Credits chip (issue #290).
This directory is deliberately outside `public/` and is never imported by
application code or served to clients; the Docker build context excludes the
whole `assets` directory.

- `credits-chip-master.png` is the owner-supplied 1254×1254 transparent render,
  committed byte-for-byte. Nothing was regenerated, recomposed or recoloured.
- `public/currency/credits-chip.webp` is the only raster the application consumes:
  the master trimmed to its alpha bounds (1188×856), resized to 320 px wide, and
  encoded as WebP at quality 90 with lossless alpha (`alphaQuality: 100`,
  `effort: 6`), 42 KB. 320 px is 4× the 80 px reward-tile artwork zone, which
  covers a 3× phone display. It was checked on dark, light and saturated
  backgrounds for fringing and at 80 px for readability of the CR mark.
- `public/currency/credits-icon.svg` is the owner-supplied simplified inline icon,
  committed unchanged. It is the single source for every inline Credit amount
  (`components/ui/CreditsAmount.tsx`).

Credits are ordinary currency, never an inventory item. The chip is the same
battered version regardless of amount; no tiers or balance-dependent art are
approved.
