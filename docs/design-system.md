# RuneSpace Design System

## Goals

The visual foundation is a mobile-first, readable low-fi sci-fi interface. It uses deep layered surfaces, cyan structural emphasis, and semantic accents without representing gameplay state.

## Tokens

`app/globals.css` owns the complete theme through `--rs-*` CSS custom properties. Tailwind exposes the core color roles for composition, but components consume token-backed classes rather than literal color values. Change a theme by changing those tokens; do not add feature-local color, shadow, bevel, control-size, or transition recipes.

Translucent tokens: a Tailwind slash-opacity modifier such as `bg-[color:var(--rs-x)]/70` cannot apply an alpha to a custom property that holds a full hex color — it compiles to invalid CSS that the browser silently drops, leaving the element transparent (an invisible layer that still intercepts pointer events). To make a token translucent, bake the alpha into the token with `color-mix(in srgb, var(--rs-x) N%, transparent)` and consume the derived token with no slash modifier; the base color stays the single source of truth.

## Primitives

`components/ui/` contains presentational primitives only: panels, headings, actions, form fields, feedback, status meters, and the responsive shell. Intent variants use `primary`, `secondary`, `success`, `mining`, `arcane`, and `danger`; use the semantic intent, never a visual hex value.

## Play surface chrome (Issue #145)

The Play footer is the fixed four-destination navigation: **Characters ·
Inventory · Map · Missions**. Inventory and Equipment share one Drawer and are
selected with tabs; Equipment is not a fifth footer destination. The surface
ownership and state rules are defined once in `docs/architecture.md`.

Location, Map, and Journey are separate compositions: Location presents the
stationary scene, activity, and same-location population/profile flow; Map is
the dedicated `?surface=map` navigation surface; Journey is the in-transit
status/feed surface. Journey feed entries are presentation only, while Travel
and Scavenge actions remain server-authoritative. Map is read-only only while
`state.travelState` exists, including after a refresh/reconciliation; it must
not retain an "opened while traveling" client latch. MISSION and TURN IN Map
guidance are intentionally deferred to Issue #143.

## Overlay motion

Shared overlay panels (`components/ui/Drawer.tsx`, including the tabbed
Inventory/Equipment surface) animate enter and exit with **opacity only**. Do
not add `transform` (scale or translate) to the panel animation: a transformed
element becomes a containing block for `position: absolute` descendants, which
breaks the absolutely-positioned artwork, nameplate, and badge inside
`components/items/VisualTile.tsx` (they jitter or misplace for the animation's
duration). If a future overlay needs motion beyond a fade, keep it off any
element that contains absolutely-positioned item tiles, or restructure those
tiles first.

## Mission guidance on beveled controls

`ActionButton` always carries `.rs-bevel`, whose clip-path clips anything
painted outside the control — outline and drop shadows included. A beveled
control therefore cannot render its own exterior Mission glow; left alone it
only changes color and inset ring, which previously passed semantic checks while
failing visually.

Any beveled control that carries Mission guidance goes through the shared
`components/ui/MissionGuidanceHalo`: an `ActionButton` becomes a
`MissionActionButton` and an `ActionLink` (such as a Local Place **Enter**)
becomes a `MissionActionLink`. Each takes one resolved `guidance`
(`"available"` blue or `"active"` green; callers resolve active-wins first). The
control keeps the shared `.rs-mission-*` color treatment and
`data-mission-guidance`; the unclipped `.rs-control-halo` wrapper paints the
exterior halo with `filter: drop-shadow()` from the existing Mission tokens, so
the glow traces the chamfer. Pass layout classes for the control's outer box
through `haloClassName`. Features never hand-roll this wrapper, the wrapper must
never be beveled or clipped, and ancestors within the glow's reach must not clip
with `overflow: hidden`.

Non-beveled Mission surfaces, such as the conversation hub's Mission entries,
apply `.rs-mission-available` / `.rs-mission-guidance` directly — their own
outline and shadow are not clipped.

The unread-News control in `features/play/PlayScreen.tsx` predates this and uses
its own unclipped `<form>` wrapper with the separate `--rs-glow-news-unread`
attention token. It could adopt `.rs-control-halo` with its own `news-unread`
tone without sharing Mission semantics, but has not been migrated.

## Accessibility

Controls use a 44px practical minimum target and visible `:focus-visible` ring. Error feedback has an alert role, disabled controls retain labels, and reduced-motion users receive near-instant transitions. Color supplements, rather than replaces, text labels and states.

## Feature Styling

Pages and features compose primitives and may add layout-only classes. Feature code must not own visual recipes or game rules. Authentication and character ownership remain in `features/` and `server/`; this system contains no inventory, resource, map, quest, or progression logic.

## Branding

The approved RuneSpace identity is a small set of committed production assets. Agents must use these exact files and must never recreate the logo in CSS, redraw it from memory, or substitute placeholder artwork.

Canonical asset paths:

- `public/branding/runespace-header-lockup.png` — the horizontal **RuneSpace wordmark / lockup** for the authenticated game header. Intrinsic size 1455×376. Render it through the shared `components/branding/RuneSpaceBrand.tsx` component, which sets the accessible name (`alt="RuneSpace"`) and fixed intrinsic dimensions so the header does not jump while the image loads.
- `public/branding/runespace-emblem.png` — the standalone **R emblem master**, used as the source for favicon/app-icon exports. Do not use it as the header lockup, with one narrow owner-approved exception: `components/public-site/PublicSiteShell.tsx` renders it as the **public-site header** identity below the responsive breakpoint documented below. The authenticated game header and every other public width still require the full lockup; do not extend the emblem to any other header or broaden this into a general alternate-logo rule.
- `public/favicon.ico`, `public/favicon-16x16.png`, `public/favicon-32x32.png`, `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png` — exported emblem icons referenced by the app metadata in `app/layout.tsx`.

Sizing and clear space (approved by the product owner; supersedes the earlier location-subtitle-in-header requirement):

- Authenticated game header: one full-width beveled header panel spanning the game-shell content width. `RuneSpaceBrand`'s default `h-auto w-auto max-h-11 max-w-[min(52vw,100%)] sm:max-h-12 sm:max-w-[min(13rem,100%)]` renders the lockup at ~44px on mobile and ~48px from the `sm` breakpoint; the caps let it shrink responsively before wrapping or overflowing, while the shared `TopBar` `trailing` slot keeps the Sign out control vertically centered inside the same panel. The header deliberately does not repeat the current-location or `In transit` subtitle — the main page location/activity panel is the authoritative visible location presentation.
- Signed-out landing: override with `h-14 w-auto sm:h-16` (~56px on mobile, ~64px from the `sm` breakpoint), inside the existing `Development build` heading card.
- Public-site header (`PublicSiteShell`): the full lockup at every width `min-[390px]` and above; below `390px`, the standalone R emblem, so the Home / Updates / Wiki nav strip fits without horizontal scrolling on narrow phones. This swap is specific to the public-site header only.
- Keep the accessible brand name; do not change the approved files' contents, compression, or dimensions.
