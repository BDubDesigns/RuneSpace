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
- `wheel-assembly.png` is the approved 1254×1254 transparent render of the
  Wheel Assembly (#322). The committed derivative
  `public/item-art/wheel-assembly.webp` follows the Fabrication-art convention
  of the Galvanic Wire Spool, Loadsteel Cutter and Freight Harness: alpha noise
  below 4 cleared, trimmed to its content, scaled to a 576 px long edge, centred
  on a 640×640 transparent canvas and saved as lossless WebP. Nothing was
  regenerated, recomposed or recoloured.
- `drive-mount.png` is the approved 1254×1254 transparent render of the Drive
  Mount (#330), generated under the former Drive Coupler name. The committed
  derivative `public/item-art/drive-mount.webp` follows the same convention as
  the Wheel Assembly: alpha noise below 4 cleared, trimmed to its content, scaled
  to a 576 px long edge, centred on a 640×640 transparent canvas and saved as
  lossless WebP. Nothing was regenerated, recomposed or recoloured.
- `oil-shale.png` and `motherlode-slab.png` are the approved 1254×1254
  transparent renders of Oil Shale and the Motherlode Slab (#342). The committed
  derivatives follow the same convention as the Wheel Assembly: alpha noise
  below 4 cleared, near-opaque alpha snapped to 255, trimmed to content, scaled
  to a 576 px long edge, centred on a 640×640 transparent canvas and saved as
  lossless WebP. The art contains no baked sparkle: the Ultra Rare shimmer is
  applied by the UI. Nothing was regenerated, recomposed or recoloured.
- `empty-small-fuel-canister.png` and `full-small-fuel-canister.png` are the
  approved 1254×1254 transparent renders of the Empty and Full Small Fuel
  Canisters (#343): a weathered silver cylinder with a brass valve, and the same
  cylinder with a red valve cap and a red vertical side locking bar. They are
  byte-identical to the owner-supplied masters. The committed derivatives follow
  the Wheel Assembly convention — alpha noise below 4 cleared, near-opaque alpha
  (252 and above) snapped to 255, trimmed to content (493×1236 and 506×1238),
  scaled to a 576 px long edge (230×576 and 235×576), centred on a 640×640
  transparent canvas and saved as lossless WebP — so the tall canister is never
  stretched. The art carries no stamped word and no fuel chamber; the red
  hardware is the fill-state cue. Nothing was regenerated, recomposed or
  recoloured.
- `rune-fragment.png` and `runestone.png` are the approved 1024×1024 transparent
  RGBA renders of the Rune Fragment (the small pointed triangular shard) and the
  intact Runestone (the larger irregular stone with a ring-like engraving)
  (#367), byte-identical to the owner-supplied masters. The committed derivatives
  follow the Wheel Assembly convention — alpha noise below 4 cleared, near-opaque
  alpha (252 and above) snapped to 255, trimmed to content (583×765 and 757×880),
  scaled to a 576 px long edge (439×576 and 495×576), centred on a 640×640
  transparent canvas and saved as lossless WebP. Both read at the 80 px
  Inventory tile size. Nothing was regenerated, recomposed or recoloured.
- Production derivatives are committed under `public/item-art/` and are the only
  item assets the application consumes
  (`game/content/item-presentation.ts`).
- The whole `assets` directory is excluded from the Docker build context via
  `.dockerignore`; the Dockerfile asserts it is absent after `COPY . .`.

`salvage-cutter.png` and `mykea-schleppraum-8.png` keep no master here: they are
still committed under `public/item-art/` at their approved sizes, because their
measured optimized responses (78,442 B and 48,838 B at `w=828`) do not justify
an art change. See `docs/audits/issue-117-image-delivery-evidence.md`.
