# QC Studio incubation boundary

This directory contains the first in-repository QC Studio implementation.

- `core/` is framework-free reusable authoring logic.
- `modules/dialogue/` is the generic Dialogue authoring surface.
- `adapters/runespace/` is the narrow RuneSpace catalog and presentation
  translation boundary.

The app route in `app/qc-studio/page.tsx` is development-gated and the route is
not part of player navigation. Do not move authoritative content, gameplay
state, or source-file publishing into this tool.
