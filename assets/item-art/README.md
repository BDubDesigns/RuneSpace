# Item artwork masters

Retained source masters for item artwork whose production derivative is smaller
than the approved render it was derived from. This directory is deliberately
outside `public/` and is never imported by application code or served to
clients.

- `power-cell.png` is the approved 1286×1247 transparent render. Issue #117
  measured its optimized dialogue-reveal response at 325,412 B — the largest
  optimized image response anywhere in the game — because `next/image` was
  resampling the full master on every request. The committed derivative is a
  640 px long-edge lossless WebP of the same render; nothing was regenerated,
  recomposed or recoloured.
- Production derivatives are committed under `public/item-art/` and are the only
  item assets the application consumes
  (`game/content/item-presentation.ts`).
- The whole `assets` directory is excluded from the Docker build context via
  `.dockerignore`; the Dockerfile asserts it is absent after `COPY . .`.

`salvage-cutter.png` and `mykea-schleppraum-8.png` keep no master here: they are
still committed under `public/item-art/` at their approved sizes, because their
measured optimized responses (78,442 B and 48,838 B at `w=828`) do not justify
an art change. See `docs/audits/issue-117-image-delivery-evidence.md`.
