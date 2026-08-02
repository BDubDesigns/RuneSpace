# RuneSpace Design System

## Goals

The visual foundation is a mobile-first, readable low-fi sci-fi interface. It uses deep layered surfaces, cyan structural emphasis, and semantic accents without representing gameplay state.

## Tokens

`app/globals.css` owns the complete theme through `--rs-*` CSS custom properties. Tailwind exposes the core color roles for composition, but components consume token-backed classes rather than literal color values. Change a theme by changing those tokens; do not add feature-local color, shadow, bevel, control-size, or transition recipes.

Translucent tokens: a Tailwind slash-opacity modifier such as `bg-[color:var(--rs-x)]/70` cannot apply an alpha to a custom property that holds a full hex color — it compiles to invalid CSS that the browser silently drops, leaving the element transparent (an invisible layer that still intercepts pointer events). To make a token translucent, bake the alpha into the token with `color-mix(in srgb, var(--rs-x) N%, transparent)` and consume the derived token with no slash modifier; the base color stays the single source of truth.

## Primitives

`components/ui/` contains presentational primitives only: panels, headings, actions, form fields, feedback, status meters, and the responsive shell. Intent variants use `primary`, `secondary`, `success`, `mining`, `arcane`, and `danger`; use the semantic intent, never a visual hex value.

## Overlay motion

Shared overlay panels (`components/ui/Drawer.tsx`, used by Inventory and Equipment) animate enter and exit with **opacity only**. Do not add `transform` (scale or translate) to the panel animation: a transformed element becomes a containing block for `position: absolute` descendants, which breaks the absolutely-positioned artwork, nameplate, and badge inside `components/items/VisualTile.tsx` (they jitter or misplace for the animation's duration). If a future overlay needs motion beyond a fade, keep it off any element that contains absolutely-positioned item tiles, or restructure those tiles first.

## Accessibility

Controls use a 44px practical minimum target and visible `:focus-visible` ring. Error feedback has an alert role, disabled controls retain labels, and reduced-motion users receive near-instant transitions. Color supplements, rather than replaces, text labels and states.

## Feature Styling

Pages and features compose primitives and may add layout-only classes. Feature code must not own visual recipes or game rules. Authentication and character ownership remain in `features/` and `server/`; this system contains no inventory, resource, map, quest, or progression logic.

## Branding

The approved RuneSpace identity is a small set of committed production assets. Agents must use these exact files and must never recreate the logo in CSS, redraw it from memory, or substitute placeholder artwork.

Canonical asset paths:

- `public/branding/runespace-header-lockup.png` — the horizontal **RuneSpace wordmark / lockup** for the authenticated game header. Intrinsic size 1455×376. Render it through the shared `components/branding/RuneSpaceBrand.tsx` component, which sets the accessible name (`alt="RuneSpace"`) and fixed intrinsic dimensions; consumers scale it with a height class such as `h-7 w-auto` (the header default, matching the 28px title line height it replaces) so the header does not jump while the image loads.
- `public/branding/runespace-emblem.png` — the standalone **R emblem master**, used as the source for favicon/app-icon exports. Do not use it as the header lockup.
- `public/favicon.ico`, `public/favicon-16x16.png`, `public/favicon-32x32.png`, `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png` — exported emblem icons referenced by the app metadata in `app/layout.tsx`.

Sizing and clear space: keep the lockup compact in the header (`h-7`); do not let it crowd the Sign out control or the location subtitle. Always preserve the live location subtitle as text and keep the accessible brand name. Do not change the approved files' contents, compression, or dimensions.
