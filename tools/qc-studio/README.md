# QC Studio incubation boundary

This directory contains the first in-repository QC Studio implementation.

- `core/` is framework-free reusable authoring logic.
- `modules/dialogue/` is the generic Dialogue authoring surface.
- `adapters/runespace/` is the narrow RuneSpace catalog and presentation
  translation boundary.

The app route in `app/qc-studio/page.tsx` is development-gated and the route is
not part of player navigation. Do not move authoritative content, gameplay
state, or source-file publishing into this tool.

The one source writer is repository-side, not part of the Studio UI:
`adapters/runespace/dialogue-apply.ts` plus `scripts/studio-apply.mjs`
(`pnpm studio:apply`) apply a reviewed export deterministically. See
`docs/qc-studio.md`, "Applying QC Studio exports".
