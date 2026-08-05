# Character portrait masters

Canonical high-resolution source masters (1254×1254 PNG) for every accepted
character portrait. This directory is deliberately outside `public/` and is
never imported by application code or served to clients.

- The authoritative catalog (`game/content/portrait-catalog.json`) maps each
  master to its stable ID, launch category, and production derivative.
- Production derivatives are committed 512×512 WebP files under
  `public/character-portraits/` and are the only portrait assets the
  application consumes.
- This directory is excluded from the Docker build context via
  `.dockerignore` (`assets/character-portraits`); the Dockerfile asserts the
  masters are absent after `COPY . .`.

Do not add, rename, or delete masters without updating the catalog, the
inventory (`docs/portrait-asset-inventory.md`), and the derivative output.
