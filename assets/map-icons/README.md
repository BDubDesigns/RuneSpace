# Map identifier masters

Retained source masters for map identifiers whose production derivative is
smaller than the approved artwork it was derived from. This directory is
deliberately outside `public/` and is never imported by application code or
served to clients.

- `the-jag.png` and `the-long-scramble.png` are the approved 1254×1254
  grayscale-alpha identifiers that predated the map-identifier pipeline in
  `docs/art-cookbook.md`. Issue #117 put them through that pipeline without
  regenerating or redesigning the silhouettes; these files are the sources that
  crop/downsample was applied to, kept so the derivatives can be re-produced at
  a different size later.
- Production derivatives are committed lossless transparent WebP files under
  `public/map-icons/` and are the only map identifiers the application consumes
  (`features/travel/local-map-identifiers.ts`).
- The whole `assets` directory is excluded from the Docker build context via
  `.dockerignore`; the Dockerfile asserts it is absent after `COPY . .`.

- `south-access-track.png` and `the-south-cut.png` are the owner-approved
  1536×1024 grayscale RGBA identifiers for the Oil Shale Mining slice (#342),
  supplied with genuine transparency and no hot-pink key. They were still put
  through the cookbook's QA: alpha below 4 cleared, near-opaque alpha snapped
  to 255, trimmed to the alpha bounds, scaled to a 512 px long edge, grayscale,
  lossless WebP, and inspected on dark and light backgrounds. Nothing was
  regenerated or recoloured.

- `holo-hollow-landing.png` is the owner-approved 1254×1254 direct-alpha H.H.
  landing-pad identifier for Holo Hollow Landing (#357), supplied separately from
  the art ZIP. `scripts/prepare-holo-hollow-landing-art.mjs` records its
  derivative: alpha below 4 cleared, near-opaque alpha snapped to 255, trimmed to
  the alpha bounds, scaled to a 512 px long edge, grayscale, lossless WebP
  (512×428), inspected on dark and light backgrounds. Nothing was regenerated or
  recoloured.

- The eight Stillreach identifiers (#373) — `stillreach-landing-station.png`,
  `windward-track.png`, `hilltop-workshop.png`, `prospecting-quarry.png`,
  `the-low-hum.png`, `the-survey-line.png`, `the-dry-seam.png` and
  `harmonic-workings.png` — are the owner-approved 1254×1254 direct-alpha RGBA masters,
  kept unaltered. `scripts/prepare-stillreach-art.mjs` records their derivation: the same
  direct-alpha recipe as above, to 512 px long-edge grayscale lossless WebPs.

The other four identifiers keep no master here: their pre-key colour sources
live in working-art storage rather than the repository, which
`docs/art-cookbook.md` explicitly allows.
