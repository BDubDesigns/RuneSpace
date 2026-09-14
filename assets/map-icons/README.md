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

The other four identifiers keep no master here: their pre-key colour sources
live in working-art storage rather than the repository, which
`docs/art-cookbook.md` explicitly allows.
