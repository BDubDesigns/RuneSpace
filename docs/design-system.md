# RuneSpace Design System

## Goals

The visual foundation is a mobile-first, readable low-fi sci-fi interface. It uses deep layered surfaces, cyan structural emphasis, and semantic accents without representing gameplay state.

## Tokens

`app/globals.css` owns the complete theme through `--rs-*` CSS custom properties. Tailwind exposes the core color roles for composition, but components consume token-backed classes rather than literal color values. Change a theme by changing those tokens; do not add feature-local color, shadow, bevel, control-size, or transition recipes.

Translucent tokens: a Tailwind slash-opacity modifier such as `bg-[color:var(--rs-x)]/70` cannot apply an alpha to a custom property that holds a full hex color — it compiles to invalid CSS that the browser silently drops, leaving the element transparent (an invisible layer that still intercepts pointer events). To make a token translucent, bake the alpha into the token with `color-mix(in srgb, var(--rs-x) N%, transparent)` and consume the derived token with no slash modifier; the base color stays the single source of truth.

## Primitives

`components/ui/` contains presentational primitives only: panels, headings, actions, form fields, feedback, status meters, and the responsive shell. Intent variants use `primary`, `secondary`, `success`, `mining`, `arcane`, `fabrication`, and `danger`; use the semantic intent, never a visual hex value. A persistent on/off toggle is latched visibly, not by `aria-pressed` alone: `secondary` while off, its activity's accent intent while on, and it stays enabled so it can be switched back. The Fabrication Station's Manual Override and Auto-discard Scrap toggles use `fabrication` (Shop Olive, with an inset glow because `.rs-bevel` clips anything outside); The shared `Auto-discard Slag: On/Off` toggle (Practice Welding and Refining, #256) reads one character-wide setting and belongs to neither skill, so it latches in `primary` on both. A toggle's label names one setting and `aria-pressed` says whether it is on, never a label that swaps between two settings. A shared control that belongs to no one skill — the bounded-run selector's **Max** — latches in `primary`, the same selected treatment as a pressed mode switch, and never borrows a skill's accent. A one-shot request such as Finish Current is not a toggle and keeps its own disabled confirmation. The Map destination panel's **Details** toggle (#240) follows the same no-skill rule: it latches in `primary`, with an inset rim so it does not read as a second primary action beside Walk.

## Canonical skill accent identity (Issue #215)

Each player-facing skill has exactly one accent identity, defined once at
`game/content/skill-presentation.ts` as a stable semantic `accentTone`
(`"mining"`, `"refining"`, `"welding"`, `"fabrication"`) — content names the
tone, never a CSS value. `app/globals.css` owns the tone → underlying accent
redirection (`--rs-skill-mining`, `--rs-skill-refining`, `--rs-skill-welding`,
`--rs-skill-fabrication`, aliasing `--rs-accent-*` tokens), and
`components/ui/skill-accent.ts`'s `skillAccentColor` is the one place a tone resolves to a color. A skill with no
approved tone (Strength; a future skill before its owner picks one) presents
neutrally rather than guessing. Fabrication's (#232) approved accent is Shop
Olive, `#7FA347` (`--rs-accent-shop-olive`).

Every progression surface consumes this through the same path instead of its
own mapping: `features/shared/activity-context.tsx`'s `SkillProgressRow`
(Mining/Refining/Welding activity screens and the Fabrication Station) and
`features/shared/CharacterSkillList.tsx` (the Character modal and Nearby
Player profiles) both call `skillAccentColor`, so a skill's name/level text and
XP fill carry the same identity everywhere it appears. Do not add a
`skill === "Mining"` conditional or a second skill → color mapping; extend the
`accentTone` registry instead.

## Play surface chrome (Issue #145)

At `min-width: 1280px` (Tailwind `xl`) Play is the desktop workspace (#286);
below it, everything in this section is the phone/tablet composition and is
unchanged, including at the ~1024px laptop width, which keeps the one-column
composition rather than a cramped dock. The desktop workspace is the same
`GameShell` with two extra slots, placed by CSS: a **24rem right rail** (sticky,
full viewport height, scrolling independently of the page) beside the main
column inside the existing `max-w-7xl` centred shell, and one compact row at the
top of the main column. The bottom navigation and floating Chat launcher are not
rendered at this width — they are replaced, not shrunk.

- **Top bar, left of News and Sign out: the Location | Map switch.** A
  two-position slide switch (`PlayViewSwitch`): a lit thumb rides a recessed
  track with a scale along its lower edge, and the light fades out of the side it
  leaves as it fades into the side it arrives at (instant under reduced motion).
  Both destinations are always on screen and the labels never change — Location
  (Journey, in transit) and Map; the current side is `aria-current`. Colour carries
  no meaning here beyond the existing "active" cyan. It opens the existing Map
  surface and, from the Map, the Location side is the single "Back to Location"
  (or "Back to Journey") control, so the Map panel does not carry a second one.
  Play-only, not account navigation. There is no separate Map row above the
  location art, and the rail never holds it.
- **Rail, upper part: Current Missions.** The same authoritative
  `MissionGuidanceStrips`, mounted once, in a region that renders nothing with
  no accepted Mission, caps its height (`min(24dvh, 12rem)`) and scrolls inside
  itself, and offers a collapse control when there are several. It must never
  push Chat's composer out of the viewport.
- **Rail, lower part: the utility workspace.** A four-tab list with exactly the
  player-facing labels **Chat, Inventory, Character, Missions**, and one docked
  utility at a time in a panel that scrolls on its own. Chat's message log
  grows to fill the height it is given (minimum 7rem), so the composer stays in
  view. The tab list is a real ARIA tab list with a roving tab stop. The Chat tab
  carries the attention count, and the Missions tab the number ready to turn in,
  as small badges whose counts are also in the accessible name. Chat is the
  home; a non-home utility shows compact **Set as default** and **Back to
  {home}** controls above its content.
- **Docked is not modal.** A docked utility is an ordinary page region: no
  backdrop, no scroll lock, no focus trap, and Escape is not captured. Anything
  that is genuinely exclusive — an accepted player trade, a mandatory reveal, a
  destructive confirmation — stays a foreground overlay at every width and is
  not squeezed into the rail.

The Play footer below is the phone/tablet fixed four-destination navigation:
**Character · Inventory · Map · Missions**. Inventory and Equipment share one Drawer and are
selected with tabs; Equipment is not a fifth footer destination. Character is a
sibling of Inventory in the same Drawer, with a sticky footer action so Switch
Character never scrolls out of reach (#213). The surface ownership and state
rules are defined once in `docs/architecture.md`.

Chat/Social (#245) is a utility over Play, not a fifth footer destination and
not a header control. Its launcher is one compact 44px icon button pinned flush
to the right edge, vertically centred in the usable viewport (below the top
safe area, above the fixed footer), through `GameShell`'s `floatingAction`
slot. The slot positions by a normalized `{ side, y }` (`FloatingActionPosition`,
default right edge at `y = 0.5`) inside a track inset by half a touch target, so
a rotation or viewport change can never strand the control offscreen; it
respects the side safe-area insets. It reserves no page space — Play keeps its
ordinary footer clearance — and simply overlays the content at the edge, like
any fixed control. That keeps it clear of the Map's sticky selected-destination
panel (#240), which keeps its own bottom position. A panel the shared selectable-details reveal scrolls to (the storage
details, #291) declares `scroll-margin-bottom: var(--rs-bottom-nav-clearance)`,
and the hook honors it even when the panel is already on screen, because a browser
treats content under the fixed footer as visible. It is per panel, not a global
`scroll-padding`, which shifted unrelated screenshot-measured controls; the `xl`
desktop rail replaces the footer, so the margin is zero there. The four footer destinations
and the header are unchanged. The launcher opens the Chat/Social Drawer over
the current Location, Map, or Journey without navigating; closing it returns
focus to the launcher. Attention reuses the News control's unread language — a
small count badge (`9+` beyond nine) and the static `--rs-glow-news-unread`
halo on an unclipped wrapper — with the count folded into the accessible name
("Chat, 2 items need attention"). A later drag-and-snap would only change the
stored `{ side, y }`; the docked desktop presentation (#286) renders the same
`ChatSocialSurface` without depending on the floating button.

General and Trade (#246) fill the Drawer's conversation region as two tabs in
the Inventory/Equipment tab style, above a fixed-height message log and the
composer. The composer states the 280-character limit with a live counter
(and "N over" instead of silently cutting text), and a send-pressure indicator
of one segment per allowed send: `--rs-chat-pressure-clear` (green),
`-low` (yellow), `-high` (orange), and `-full` (red), where red disables Send
and reads "Slow down · Ns". The label text always carries the state, so color
only supplements it. Trade's **Promote** is a latched toggle (`secondary` off,
`primary` on) that turns Send into "Post ad · 50 Credits". A promoted ad is
slightly larger text on `--rs-chat-promoted-surface` with a
`--rs-chat-promoted-border` rim and soft `--rs-chat-promoted-glow`, labelled
"Promoted ad" — brighter than ordinary chat, never an alert.

Whispers (#247) are the third tab. Unread Whispers use the News unread
language on both the launcher and the tab (count badge plus
`--rs-glow-news-unread`, count in the accessible name). The tab opens with a
**Start a Whisper** panel (one exact character name and a **Whisper** button;
refusals appear inline under it), then lists conversations (name, latest
line, time, unread badge) under a **Blocked players** control; a conversation
has an **All
Whispers** back control, the other character's current name, and **Report** /
**Block** beside it, above the same log and composer as public chat. Another
player's message carries a compact "…" actions toggle, and its sender name is
a dotted-underlined button for the same toggle (the easy target on a phone);
either expands **Whisper** (public feeds only), **Report**, and **Block** under
the body. Block and Report
open inline in place of the composer (or inside the profile), never as a
separate route: Block is a `danger`-rimmed confirmation that says what it does
and that the other player isn't told; Report is a reason radio list, an
optional note with a counter, and an **Also block** checkbox that turns the
submit into "Report and block". The same-location character profile gains
**Whisper**, **Report**, and **Block** under its identity.

Public `@mentions` (#261) keep General and Trade quiet: only a message that
mentions your character is personal. Typing `@` in either composer opens an
in-flow list of matching characters under the box (touch-target rows,
`--rs-accent-primary-subtle` on the active row; arrows, Enter, or Tab choose,
Escape closes only the list), and choosing inserts `@Name`. In the log, each
resolved `@Name` is bold in `--rs-chat-mention-other`, or
`--rs-chat-mention-accent` when it is you, and a message that mentions you
gets a 4px `--rs-chat-mention-accent` left rim and a "Mentions you" label —
personal, never a fill or an alert, so it stays distinct from a promoted ad.
Unread mentions badge the General or Trade tab and light the launcher in the
News unread language, with the count in the accessible name ("General, 1
unread mention").

A blocked player's General/Trade message (#261) keeps its place as a
placeholder: their name and time in the usual header, then *Message hidden —
blocked player* in italic `--rs-text-muted`. It has no actions toggle,
tappable name, or reveal — it is orientation, not a warning. A Whisper
conversation's header adds a plain **Hide** beside **Report** / **Block**;
hiding returns to the list with a success line saying how it comes back.

The read-only **System** conversation (#274) is a Whisper-styled row pinned
first in that list, with the same unread badge language; its unread count adds
to the Whispers tab badge and lights the launcher as its own attention source.
Opened, it shows the same **All Whispers** back control and log, with
"System" as the sender, and replaces the composer with a muted line saying
System messages are automatic and can't be replied to. It has no **Report**,
**Block**, actions toggle, or tappable sender name.

Player trading (#268) adds **Trade** at the head of that profile row
(Trade · Whisper · Report · Block; Trade alone for one of the player's own
characters). While a request waits, the row shows "Waiting for <character>…"
and **Cancel Request** instead of Trade — no countdown. Incoming requests are
pinned Chat/Social cards with **Accept** and **Decline**, rimmed
`--rs-accent-primary`; when the server flags repeated requests the card turns
`--rs-accent-danger`-rimmed and leads with **Decline & Block**, which opens the
ordinary Block confirmation. The requester's own waiting request is a quiet,
structural-rimmed card that never lights the launcher. An accepted trade is the
shared `Drawer` at `size="full"` (near full screen on a phone, at most 60rem
wide on desktop) and cannot be dismissed: **Cancel Trade** leaves it. Its
footer of primary actions sits under a scrolling body, so **Cancel Trade**,
**Ready**, **Change Offer**, and **Confirm Trade** (`success` intent) never
scroll away. **You offer** and **They offer** stack on a phone and sit side by
side from `sm`; a Ready side is locked behind a 1px `--rs-accent-success`
inset ring with a "Ready — locked" chip — the success language, not a fill.
Both Ready replaces them with the frozen **You Give** / **You Receive**
review. A refused final Confirm shows its reason as a `danger` line above the
offers while that player is composing, never next to Ready or Confirm. A unique item's charge reads "Charge 7/10" in `--rs-accent-mining`
wherever it appears. Names use `overflow-wrap: anywhere`, so no name or item
label can force horizontal overflow.

Location, Map, and Journey are separate compositions: Location presents the
stationary scene, activity, and same-location population/profile flow; Map is
the dedicated `?surface=map` navigation surface; Journey is the in-transit
status/feed surface. Journey feed entries are presentation only, listed newest
first with the latest one emphasised (#240), while Travel and Scavenge actions
remain server-authoritative. Map is read-only only while
`state.travelState` exists, including after a refresh/reconciliation; it must
not retain an "opened while traveling" client latch. Map hexes render MISSION
and TURN IN Mission-guidance markers (Issue #143); see `docs/missions.md` §10
for guidance semantics and `docs/travel-map-design.md` for the marker/ring
presentation contract.

## Stationary Location composition (Issue #193)

Every stationary Play surface — World Location and Local Place alike — composes
in one order. This is the authoritative home for that grammar;
`docs/architecture.md` owns which surfaces exist, and each feature owns its own
gameplay.

1. **The place.** One raised panel: scene, description, one row per resident
   in authored order (#231), and who else is here — once, after the people,
   below one structural hairline that closes the resident block (none when
   nobody is resident).
   `features/location-scene/LocationSurface.tsx` and
   `features/local-places/LocalPlaceSurface.tsx`.
2. **The primary activity.** A sibling panel, never nested inside the place —
   `features/shared/ActivityPanel.tsx`, selected by the one narrow switch in
   `features/location-scene/LocationActivity.tsx`.
3. **Compact context**, inside the activity panel: `SkillProgressRow` and
   `ActivityContextRow` from `features/shared/activity-context.tsx`.
4. **This Run**, inside the activity panel: `features/shared/RunSummary.tsx`.
5. **Secondary systems**, as their own panels — Work Orders, Cargo Hold storage
   once repaired, the Crew Stop's hauler.

**Several work areas in one place (#232).** When one World Location offers more
than one activity — Rusk Recovery's Welding Workshop and Fabrication Station —
a row of prominent work-area cards sits between the place (1) and its activity
(2), never a dropdown, and only the selected area's surfaces render beneath it
in the order above. The place's art and people stay shared and do not move. The
cards carry Mission guidance with the shared exterior halo, draw their keyboard
ring inside the card as the beveled controls do, and follow the running work.
It is Rusk Recovery's own composition
(`features/location-scene/RuskRecoveryWorkAreas.tsx`), not a framework: a
second place with work areas earns the abstraction.

Rules that follow from it:

- **The place owns the screen's one `h1`**, and it is the scene plate that
  already displays the place's name (`LocationSceneHeader`). Panels beneath it
  pass `level={2}` to `SectionHeader`; blocks inside those panels pass
  `level={3}`. `SectionHeader` still defaults to `1` for the non-Play surfaces
  that are their own page.
- **Inside an activity, the control comes first**, then active progress, then
  the compact context and run summary. Copy that explains a control goes below
  it. This ordering is most of what keeps a primary control above the fold.
- **The fold is the acceptance criterion.** At the canonical 390×844 viewport,
  with ordinary Mission state and nothing manually expanded, an activity's
  primary control is fully visible without scrolling — above 783px, which is the
  viewport less the 61px fixed navigation (`--rs-bottom-nav-box-height`). This
  is a default-state target: it does not extend to 200% text scaling, opened
  disclosures, or unusually long Mission content.
- **Compact means compact, not hidden.** Skill progression, the activity's
  materials and the current run stay visible by default. Only reference detail —
  a bounded attempt history, a merchant's counter — sits behind a control.
- **A deep interaction opens its own surface.** Talk and Trade both use
  `components/ui/Drawer`; an inline expansion that pushes the place's activity
  down the page does not.
- **Empty slots render nothing at all** — no empty frame, no "nothing here yet"
  placeholder.
- **Two inventories look like two inventories** (#199). Where a surface shows
  the carried inventory beside a stored one — the Cargo Hold's desktop
  composition — each is its own bounded region carrying its own name and
  occupancy, with a real gap between them. Both regions use the identical
  surface and border: the separation comes from grouping and hierarchy, never
  from a colour that would imply the items inside differ. Narrow widths keep
  the existing switcher and show one region at a time.
- **Activities stay feature-owned.** `ActivityPanel`, the context rows and
  `RunSummary` are presentation: no gameplay props, no `server/` imports, no
  location or action IDs. There is no universal activity framework, no shared
  run state, and the location-to-activity mapping is a switch rather than a
  registry.

Legitimate exceptions, all deliberate: Holo Hollow's town surface has no
activity (its Places directory is the interaction, and is out of scope for
#193); the Long Scramble, the Assistance Center and the B&B are place-only; the
Power Annex has no skill or run; the Crew Stop has an activity and no resident;
and the Crash Site's Cargo Hold is the primary activity while it is a repair and
a secondary system once it is storage.

## Item tiles: the reserved label area (Issue #199)

`components/items/VisualTile.tsx` is the one item-tile treatment, and every
fixed-size tile reserves the same label area at its bottom edge:
`--rs-item-label-block` tall, holding up to two lines of the uppercase name at
`--rs-item-label-line-height`. Both tokens live in `app/globals.css`.

- The band is the same height whether a name needs one line (`SLAG`) or two
  (`REFINED FERRITE`), so a mixed inventory keeps one tile geometry and scans
  as a grid rather than as cards of different heights.
- The name wraps normally inside the band; `line-clamp-2` spends the ellipsis
  only on a name that cannot fit the two lines it is given.
- The artwork layer stops where the band starts, so a second line of name never
  covers art that a single-line name leaves visible, and the `h-20 w-20`
  artwork still resolves at full size inside a `min-h-28` tile. Changing either
  token without re-checking that arithmetic will start shrinking item art.

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
becomes a `MissionActionLink`. Each takes one resolved `guidance` value —
`"available"` (blue, a new Mission offer), `"active"` (green, accepted work),
or `"turn_in"` (blue, every requirement satisfied and only the handoff
remains — its own `mission-turn-in` halo tone, distinct from `"available"`'s
even though both paint blue); callers resolve precedence (active over turn-in
over available) before passing one value. `docs/missions.md` §10 owns the
semantics. A guided control always sits on the ordinary dark `secondary`
control surface — `MissionActionButton` / `MissionActionLink` override the
caller's `intent` while guided — so the Mission colour lives only on its text,
its 2px inset edge ring, and its exterior halo, never its interior (a tinted or
translucent fill lets the halo wash through and blurs the control). The
control keeps the shared `.rs-mission-*` color treatment and
`data-mission-guidance`; the unclipped `.rs-control-halo` wrapper paints the
exterior halo with `filter: drop-shadow()` from the existing Mission tokens, so
the glow traces the chamfer. Pass layout classes for the control's outer box
through `haloClassName`. Features never hand-roll this wrapper, the wrapper must
never be beveled or clipped, and ancestors within the glow's reach must not clip
with `overflow: hidden`.

The Play Mission strips (`features/missions/MissionGuidanceStrips.tsx`, #174)
are non-beveled too: each strip is a dark `--rs-surface-panel` row carrying the
shared `.rs-mission-guidance` (work) or blue (turn-in) class directly, so its
border, text colour, outline, and exterior glow come from the same tokens and
are never clipped; body text stays `--rs-text-primary` for legibility. The stack
is normal flow under the Play header, not sticky. Semantics live in
`docs/missions.md` §10.

Non-beveled Mission surfaces, such as the conversation hub's Mission entries,
apply `.rs-mission-available` / `.rs-mission-guidance` directly — their own
outline and shadow are not clipped.

The unread-News control in `features/play/PlayScreen.tsx` predates this and uses
its own unclipped `<form>` wrapper with the separate `--rs-glow-news-unread`
attention token. It could adopt `.rs-control-halo` with its own `news-unread`
tone without sharing Mission semantics, but has not been migrated.

## Accessibility

Controls use a 44px practical minimum target and visible `:focus-visible` ring. A beveled control (`.rs-bevel` + `.rs-focus`: `ActionButton`, `ActionLink`, their Mission variants, form fields, footer destinations) would clip an outside ring, so one shared rule in `app/globals.css` draws its ring inside instead, inset by `--rs-bevel-focus-inset` so the ring clears the chamfer and sits apart from a Mission-guided control's inset green/blue ring — focus and Mission guidance stay two separate marks. Pointer focus shows no ring. Prove focus paints with rendered pixels (`expectKeyboardFocusRingPaints` in `tests/e2e/fixtures.ts`), not `getComputedStyle()`, which reports the clipped outline as present. Error feedback has an alert role, disabled controls retain labels, and reduced-motion users receive near-instant transitions. Color supplements, rather than replaces, text labels and states.

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
- Public-site header (`PublicSiteShell`): the full lockup at every width `min-[390px]` and above; below `390px`, the standalone R emblem, so the Home / Updates / Wiki nav strip fits without horizontal scrolling on narrow phones. This swap is specific to the public-site header only. Neither of the two marks is a `priority` image (issue #117): both are always rendered and a CSS breakpoint decides which one is displayed, but a preload is unconditional, so preloading made every visitor download the mark they could not see (measured 9,218 B at 390px, 32,334 B at 360px). Left to lazy loading the browser fetches only the displayed mark — which is in the initial viewport and therefore still requested immediately. The authenticated game header and the landing hero lockup are unaffected and keep their `priority`.
- Keep the accessible brand name; do not change the approved files' contents, compression, or dimensions.
