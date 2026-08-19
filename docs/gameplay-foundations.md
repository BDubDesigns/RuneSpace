# Gameplay Foundations

This is the authoritative design record for the server-authoritative foundations
introduced in issue #16 and the approved Ferrite Shale Mining slice. It defines
contracts and approved values, not unfinished balance values or future activities.

## Time and actions

- A game tick is exactly 600 milliseconds.
- An action is an ongoing character activity. An attempt is one server-resolved
  outcome after its whole-tick duration elapses.
- Activities define base attempt durations in whole ticks. Player-facing speed
  multipliers divide duration and round upward to a whole tick:
  `ceil(normalAttemptTicks / speedMultiplier)`. The approved Power Cell Mining
  boost is 2x, so a 10-tick attempt takes 5 ticks.
- A character may have only one active action.
- The server resolves actions lazily when a character is loaded or a
  state-changing command runs. There is no client tick loop, worker, or timer.
- Standard accounts resolve only the latest one hour of unresolved time. The
  durable cursor advances atomically past capped older time, then only through
  ticks an action resolver actually consumed; partial attempt progress remains.
- Every state-changing character command must lock, resolve pending action work,
  persist its outcome and cursor, then validate and apply the requested command
  in the same transaction. Retried or concurrent requests must not duplicate an
  outcome.
- Resolution loads action-specific authoritative state under that same lock,
  passes an immutable snapshot to pure deterministic resolution, and gives the
  following command the reloaded final action state after continuing, stopping,
  or replacing an action. Replacement resolvers provide only their action ID and
  start time; orchestration remains the sole owner of durable resolution cursors.

## Progression

- Total skill XP is authoritative persisted character state. Level is always
  derived from total XP and a supplied authoritative threshold source.
- Every future award must use `grantSkillXp`; activities must not implement XP
  arithmetic or level checks themselves.
- The initial Mining curve and Ferrite Shale award are approved in the slice below;
  other skills and activities remain deliberately undecided.

## Ferrite Shale Mining slice

The first playable action is infinite Ferrite Shale Mining at The Jag. Its concrete
values live only in `game/config/balance.ts` behind `getEffectiveGameBalance()`:
10 ticks (six seconds) per normal attempt; 15 Mining XP on success; 1 or 2 shale per
success; 100 g shale units with a 10-unit stack limit; and the approved level-1
35% to level-30 guaranteed-success basis-point formula. Failures grant neither
shale nor XP. Server-generated randomness is resolved in the locked action
transaction, so refreshes and retries cannot replay an outcome.

Mining stops before a roll when the minimum yield cannot fit, when its equipped
Salvage Cutter is missing, when manually stopped, or when replaced. The starter
loadout is provisioned once transactionally: a 5 kg Salvage Cutter, one 10 kg
MYKEA SCHLEPPRAUM-8 eight-slot container, and the approved 50 kg carry capacity.
No quest state is associated with the damaged-ship guidance.

The current Mining run is bounded per-character state. Aggregate totals survive
refreshes and stopping; only the latest ten immutable server-resolved attempt
summaries are retained. Starting a genuinely new Mining action resets this run.

## Refining slice (issue #81)

Processing Yard Refining consumes exactly 2 Ferrite Shale per attempt and
produces one server-authoritative result: 1 Refined Ferrite (150 g, stack limit
5) plus 15 Refining XP on success, or 1 Slag (150 g, stack limit 10) plus 3
Refining XP on failure. The success chance is 40% at Refining level 1,
increasing linearly to 100% at level 20 and clamping thereafter
(basis-point integer math, server-authoritative roll). One attempt takes
exactly 7 ticks (4.2 seconds); there is no speed boost for Refining.

Refining is available only while stationary at the Abandoned Processing
Yard. Travel generalizes so that starting Travel while Mining or Refining is
active resolves only already-completed work exactly once, persists it
atomically, discards any partial attempt, stops the work action with
`action_replaced`, and begins Travel. The preflight for each attempt
simulates removal of the 2 shale and validates that the resulting inventory can
accept either possible 1-item output (stack/mass/capacity); if only one branch
would fit, no roll is made. All input removal, output addition, XP, run
history, and cursor changes commit atomically.

The refining run mirrors Mining: current Refining level/XP, success chance,
bounded recent attempts (10), and current-run counters (attempts, Refined
Ferrite, Slag, XP, shale consumed) — reset only on a genuinely new run.

## Inventory and equipment

- Fungible items are carried as positive-quantity stacks. Unique items are
  individual instances and may contain mutable state such as current charge.
- A stack and each carried unique instance consume one inventory slot. Compatible
  partial stacks fill before new stacks are created.
- The Inventory screen renders every carried entry: each stack occupies one tile
  and each unequipped unique item instance (such as a carried Salvage Cutter)
  occupies one tile with its approved artwork, display name, and any approved
  persistent state. Equipped items never appear in Inventory. The reported
  occupied count always equals the rendered stacks plus carried unique
  instances, and empty tiles begin only after every carried entry.
- Slot capacity is the sum of equipped container capacities. Carry capacity is
  independently derived from supplied Strength, buff, and equipment
  contributions. Neither derived capacity is persisted.
- Equipped gear, including containers, counts toward carried weight but occupies
  no inventory slot. Containers are unique equipped items assigned through the
  dedicated container-slot namespace; future content supplies stable slot IDs.
  They cannot contain containers.
- Item names, weights, stack limits, maximum charges, container capacities, and
  equipment classification belong to validated typed content, not player rows.

### Inventory item actions (issue #58)

- Selecting an occupied Inventory tile (mouse, touch, or keyboard) opens one
  compact detail/action area inside the existing Inventory drawer. One entry is
  selected at a time; selecting another entry replaces the selection, and empty
  slots stay non-interactive. Selection and pending confirmation are transient
  drawer state: closing Inventory clears them, and an authoritative update that
  removes the selected entry clears or safely transitions the selection.
- Stack details come from the authoritative projection and typed content:
  approved artwork, display name, quantity, per-item and total mass, and the
  approved stack limit. Carried unique items show their artwork, display name,
  mass, and approved persistent state (such as Cutter charge) and carry no
  Drop, Equip, Use, or Destroy action.
- `Drop 1` and `Drop stack` are available for stack rows only. Both require an
  inline confirmation stating the item, the exact quantity, and that dropped
  items are **permanently destroyed in the current development build**. The
  server-authoritative `discardInventoryStack` command locks the owned stack,
  validates the confirmed quantity after any due-work reconciliation, and
  refuses safely when the stack changed. Real ground items, map coordinates,
  visibility to other players, pickup, trading, and transfers remain future
  work; no world object is created by dropping.
- Inventory Power Cell loading is a convenience route to the same
  server-authoritative `loadSalvageCutterPowerCell` command and transaction the
  Equipment surface uses, via the same `loadPowerCellAction` client action. It
  is enabled only when the authoritative state shows a loose cell, an equipped
  depleted Cutter, and no conflicting command in flight, and it explains the
  reason whenever it is unavailable. Equipment remains the full Cutter
  charge/status surface.

## Approved identities and boundaries

Near-term stable skills are Mining, Refining, Welding, and Strength. Stable
opening item identities are Ferrite Shale, Refined Ferrite, Slag, Crash-Grade
Structural Alloy, Salvage Cutter, and Power Cell. These identities establish no
weights, capacities, charge behavior, rewards, starter loadout, or action beyond
their approved slice.

Mining extracts raw material from the infinite Ferrite Shale seam at The Jag. Refining
(issue #81) consumes 2 Ferrite Shale per 7-tick attempt at the Abandoned
Processing Yard, producing 1 Refined Ferrite (150 g / stack 5, 15 XP) on
success or 1 Slag (150 g / stack 10, 3 XP) otherwise, with a 40%→100% L1–20
linear success curve. Welding joins material and repairs structures. Salvage
dismantles and recovers components. Fabrication assembles finished objects.
Machining creates precise components. Salvage, Fabrication, Machining, Speeder
Piloting, and Ship Piloting are documented future skill directions only; they
have no persistence initialization or gameplay in this foundation.

## World and Travel (issues #40, #47, and #83)

RuneSpace's production stages require movement between distinct places. Travel is
a real, server-authoritative, blocking character activity — not an instant tab
switch or a client timer. Issue #40 establishes the smallest correct
world-and-travel foundation on which later Metallurgy, Welding, exploration, fog
of war, fuel, hauling, and transportation upgrades build.

### Persistent location

- Every character has exactly one authoritative persistent current location.
- The `characters.current_location_id` column is the single source of truth. It
  defaults to the Crash Site for existing characters (migration backfill) and for
  newly provisioned characters (authoritative provisioning path). Clients cannot
  submit or overwrite it.
- Locations are data-driven, validated content resolved from a typed registry
  (`game/content/locations.ts`). Each location defines its stable ID, display
  name, description, directly adjacent location IDs, available activity IDs, and
  dormant (future) activities. Adjacency is validated as bidirectional so a
  one-way edge can never silently ship.

### The five-location local world (issue #83)

- **Crash Site** (`crash_site`): the wreck / starting location after issue #83.
  No Mining is available here; it retains its existing ship scene image.
- **Abandoned Processing Yard** (`abandoned_processing_yard`): the
  Refining location (issue #81). Refining is available here while stationary;
  the location advertises `processing_yard_refining` as its available action.
- **DeWhat? Emergency Power Annex** (`dewhat_emergency_power_annex`): an
  adjacent emergency-supply depot. It is directly adjacent to both existing
  locations and is the authoritative renewable source for the daily Power Cell
  allotment below.
- **The Long Scramble** (`the_long_scramble`, `{q:-1,r:2}`): intentionally barren
  traversal tile southwest of Crash Site. No local activity or resource; its lack
  of activity is intentional, as is Crash Site's, and neither has a fake Offline status.
- **The Jag** (`the_jag`, `{q:-2,r:3}`): Ferrite Shale Mining location (Mining moved
  out of Crash Site). Mining is available only here while stationary.

Adjacency after issue #83 (bidirectional, no second graph): Crash Site ↔
Processing Yard, Crash Site ↔ Power Annex, Processing Yard ↔ Power Annex,
**Crash Site ↔ The Long Scramble**, **The Long Scramble ↔ The Jag**. No direct
Crash Site ↔ Jag, Jag ↔ Yard/Annex, or Long Scramble ↔ Yard/Annex edge exists.
Reaching The Jag from anywhere except The Long Scramble requires explicit
completed legs (for example Annex → Crash Site → Long Scramble → Jag). No queued
route, shortest-path, waypoint, or auto-continue behavior exists.

Coordinates are presentation-only (flat-top axial); Travel legality is derived
solely from registry adjacency, not from coordinates. The local map derives route
lines from the same authoritative adjacency.

### Travel is a blocking one-active-action activity

- Travel reuses the existing one-active-action and lazy server-resolution model.
  It is an `active_actions` row (`travel`) owning a `character_travel_state` row
  (origin, destination). The active action's `started_at` is the sole
  authoritative travel start time; the travel row stores only route data. The
  current location stays the authoritative origin until arrival commits.
- The approved initial adjacent walking duration is **40 game ticks = 24
  seconds** (canonical 600 ms tick), sourced from the typed authoritative
  balance boundary (`game/config/balance.ts`), not from React or command code.
  This is an initial playtest value; not every future adjacent route must share
  it.
- Resolution is lazy: a normal page load or state-changing command resolves
  arrival after the 40 ticks elapse, advancing the action cursor exactly once,
  setting the current location to the destination, and clearing travel state.
  There is no worker, WebSocket, client progression loop, or background timer.
- Travel progress (partial cursor) survives refresh, reconnect, logout, and
  deployment. Partial or concurrent resolution cannot move the character twice.

### Selecting vs. confirming travel

- Selecting a hex on the three-hex local map only inspects/selects it.
- A separate explicit confirmation control ("Walk to … — 24 sec") invokes the
  server-authoritative begin-travel command. The same interaction works in
  reverse after arrival.

### Location population (issue #62)

The current-location map tile shows the other characters currently persisted
at that same location, so the world feels inhabited:

- **Source of truth:** `characters.current_location_id`. The read boundary is
  scoped by the owned active character; the server resolves the location and
  the browser can never enumerate a location directly. A character in transit
  keeps its authoritative origin location until arrival commits, so it counts
  as present there — the population read adds no new presence rule.
- **Which characters appear:** every *other* character whose authoritative
  location matches, including multiple characters owned by the same player as
  separate entries and the requesting player's other same-location characters.
  Only the active character itself is excluded.
- **Information shown:** each entry shows the character display name, the
  character's current derived level (the existing Mining progression boundary
  over persisted skill XP — no new level formula or stored level), and the
  owner's public name (`user.name`). Emails, account IDs, character database
  IDs, and private state are never exposed.
- **Presentation:** a compact count indicator on the occupied tile plus an
  accessible "Characters here" disclosure (label, compact count badge, and
  disclosure chevron) revealing the list, associated with that tile. Each
  entry is an interactive row — character name, owner name, and a compact
  level badge with a chevron affordance — and the row of the character whose
  profile is open stays visibly selected (gold accent, tinted background, and
  a "Viewing" indicator) until the panel closes or is invalidated.
- **Current low-population version:** all matching persisted characters are
  shown regardless of `lastPlayedAt` or any activity notion. Refresh happens on
  initial load and whenever the active character receives refreshed
  authoritative gameplay state (for example completing Travel or a status
  refresh); there is no presence system, heartbeat, or real-time
  infrastructure.
- **Deferred future work:** when population grows, RuneSpace should show only
  characters active within the previous ten minutes, with Mining activity
  counting as activity even without repeated commands. That requires a
  deliberate authoritative activity definition and persistence/update
  semantics and is explicitly **not** implemented here; no ten-minute filter,
  heartbeat, or `updatedAt`-as-presence rule exists in this version.

### Same-location character profiles (issue #64)

Every visible character name in the #62 same-location list is an accessible
interactive control that opens one compact, mobile-first public profile panel:

- **Public fields only:** character display name, the owner's public name
  (`user.name`), the character's portrait presentation, the character's overall
  level, and one generic skill row per published skill. Emails, account IDs,
  character database IDs, skill IDs, inventory, equipment, charge, current
  action, and other private state are never exposed.
- **Interaction:** selecting a name opens the panel; selecting another visible
  name updates the same panel rather than stacking panels; Close and Escape
  return focus to the name that opened the current view. The panel is a
  non-modal inline region so the name list stays interactive; the shared modal
  Drawer is not used for this surface.
- **Server revalidation:** the profile read is a narrow authenticated boundary
  scoped by the owned active character (the same authenticated scope as #62).
  The target is identified by its public display name only — no character IDs
  leave the server — and one set-based statement requires, in the same database
  snapshot, that the target is a different character whose authoritative
  `current_location_id` equals the active character's current location at read
  time. Unknown, invalid, active-character, and other-location targets all
  receive one indistinguishable refusal. The panel re-reads on every open,
  every target switch, and every accepted authoritative gameplay revision, and
  is invalidated immediately when the active location changes.
- **Overall-level rule:** the overall level is the highest derived level across
  the character's published skills (skills with an approved level curve), with
  level 1 as the baseline; with Mining as the only published skill it equals
  the Mining level. No total-level field is persisted and no formula is
  duplicated in the UI.
- **Skill rows:** each published skill shows its player-facing name (from the
  authoritative skill-presentation content boundary), current derived level,
  total XP, XP earned within the current level, XP required for the next level,
  and an accessible progress meter. All thresholds come from the authoritative
  balance boundary (`skillLevelThresholds` in `game/config/balance.ts`) through
  the shared `skillLevelProgress` domain helper — the same helper the Mining
  state projection uses. At the maximum level the panel shows the level cap and
  total XP truthfully and fabricates no further requirement.
- **Current scope:** Mining is the only skill with an approved level curve and
  is therefore the only published skill. Strength has a persisted starter XP
  row but no approved curve and is not presented. A future approved curve (one
  entry in the balance boundary) publishes that skill automatically — no
  Mining-specific component or projection branch exists.
- **Portrait:** the panel renders the character's resolved portrait
  presentation through the shared `components/portraits/CharacterPortrait`
  boundary (see "Character portraits" below): the selected catalog portrait as
  a normal `next/image` derivative, or the neutral system placeholder
  silhouette when no valid selection exists.

### Character portraits (issue #65)

Every RuneSpace character has one deliberate, per-character portrait choice
that is used wherever the character is publicly presented.

- **Selectable set:** exactly the ten `player-starter` entries of the
  authoritative Issue #70 portrait catalog
  (`game/content/portrait-catalog.ts`, `PLAYER_STARTER_PORTRAITS`). `npc-only`
  and `reserved` portraits are valid production assets but are never offered in
  the picker, never accepted by creation or change commands, and never shown as
  locked cards. Availability is catalog metadata only — a future approved
  selectable portrait is added by reclassifying (or adding) a catalog entry,
  never by moving an asset or touching validation code.
- **No default portrait:** a human portrait is never assigned automatically.
  New characters must deliberately choose one during creation; the stable
  portrait ID is persisted atomically with the character row in the same
  transaction. The neutral system placeholder is a separate, non-catalog
  presentation — not selectable and never persisted as though the player chose
  it.
- **Nullable legacy persistence:** `characters.portrait_id` is nullable by
  design (`portraitId: string | null`). Characters created before this feature
  remain `null` and continue to work; no migration screen, random assignment,
  or silent backfill exists. Rows store only the stable portrait ID — never
  paths, URLs, labels, image blobs, or metadata.
- **Ownership and validation boundary:** creation and portrait changes are
  server-authoritative (`server/characters.ts`). The server authenticates the
  request, validates the ID against the catalog-derived `player-starter`
  subset, verifies ownership on every change, and updates only the requested
  owned character with an atomic ownership-scoped statement. `npc-only`,
  `reserved`, unknown, malformed, and retired values are refused; concurrent or
  retried saves converge on one valid final selection without corrupting state.
- **Resolution and public projection:** one narrow domain boundary
  (`game/domain/character-portrait.ts`) resolves a stored value to either the
  safe catalog presentation of a valid `player-starter` ID or the neutral
  placeholder for null/unknown/malformed/retired/non-selectable values.
  Resolution never rewrites the database row. Public projections expose only
  the approved presentation fields (name, committed derivative path, intrinsic
  dimensions, accessible description) — never categories, master paths,
  concepts, or raw IDs.
- **Image delivery:** application code references only the committed optimized
  derivatives in `public/character-portraits/` through the normal `next/image`
  boundary with the catalog's intrinsic dimensions and responsive `sizes`;
  high-resolution masters in `assets/character-portraits/` are never consumed
  by app code. Derivatives are committed assets — never generated at build,
  startup, or request time.
- **Management surface:** the character-selection screen shows each owned
  character's portrait presentation and a Choose/Change portrait flow that
  reuses the same catalog-derived picker used during creation. The shared
  picker (`components/portraits/PortraitPicker.tsx`) is a responsive,
  keyboard-and-touch-accessible grid with a programmatically exposed selected
  state. Public profile panels remain read-only.

### Atomic work-action → Travel replacement (issues #40 and #81)

When Travel replaces an active travel-replaceable work action (Mining or Refining):

1. The character and active-action state is locked.
2. Only attempts already completed before the command are resolved,
   exactly once, and persisted (XP, inventory, history, cursor).
3. The work action stops (recorded as `action_replaced`).
4. Travel begins from the still-current origin to the validated destination.
5. The entire transition is committed atomically.

No work action may progress during Travel, and the server enforces this
server-side even against a stale or manipulated client.

### Location/activity gating (after issue #83)

- Ferrite Shale Mining may start only at The Jag while stationary.
- Mining cannot start at Crash Site, The Long Scramble, the Processing Yard, the
  Power Annex, or while Travel is active. The server rejects those starts; hiding
  UI is insufficient.
- Crash Site and The Long Scramble have no local gameplay activity or resource;
  neither is shown as Offline or given filler controls.
- Conflicting state-changing commands are rejected clearly and server-side.
- Inventory and Equipment remain inspectable during Travel.

### Daily Power Annex claim (issue #47)

- RuneSpace daily reset dates are calendar dates in the IANA timezone
  `America/Los_Angeles`, changing at local midnight. Daylight-saving transitions
  are handled by timezone-aware date calculation; this is not a rolling
  24-hour timer.
- Each character may claim exactly five loose `power_cell` items once per
  Pacific reset date after physically traveling to and stopping at the DeWhat?
  Emergency Power Annex. Eligibility is per character, not per account.
- Each loose Power Cell weighs **500 g** and stacks to **5**. The full allotment
  weighs **2,500 g** and is awarded all-or-nothing: existing partial stacks are
  filled before only the required new stack rows are created, subject to slot
  and carried-mass capacity.
- Claims are immutable character/source/reset-date records with a uniqueness
  boundary; no mutable claimed flag or midnight background job clears state.
  The inventory award and claim record commit atomically. The Annex is the only
  approved source in this slice; there are no starter or backfilled Power Cells.
- Power Cell boosting is defined in the Issue #24 section below.

### Salvage Cutter Power Cell boost (issue #24)

- A loose `power_cell` is a 500 g fungible stack item with a stack limit of five.
  Issue #47's DeWhat? Emergency Power Annex is the renewable source; there are no
  starter or backfilled cells.
- Loading one carried Power Cell into the equipped, depleted Salvage Cutter
  consumes the cell completely and sets the Cutter's durable charge to ten.
  Loading is allowed while idle or while another action is active; if Mining is
  active, due Mining work is resolved first in the same transaction. A nonzero
  charge cannot be overwritten.
- While charge is greater than zero, each next Mining attempt uses
  `ceil(normalAttemptTicks / 2)` (currently 5 ticks / 3 seconds). The boost changes
  timing only: success chance, random rolls, yield, XP, inventory planning, and
  progression are unchanged.
- Every resolved boosted success or failure consumes exactly one charge. A
  preflight stop consumes no charge. When the tenth boosted attempt reaches zero,
  the same Mining action continues automatically at its normal 10-tick duration.
- Resolution walks the durable action cursor sequentially, choosing the current
  boosted or normal duration for each attempt. A single active/offline batch may
  therefore cross from 5-tick boosted attempts to 10-tick normal attempts; the
  cursor advances only by the actual whole ticks consumed and preserves partial
  progress toward the next attempt.
- Cutter charge is stored on the unique `item_instances.current_charge` row, so
  refresh, reconnect, stop/start, travel, offline resolution, and re-equipping the
  same instance preserve it. Attempt history remains bounded to the latest ten
  summaries and records boost mode, actual duration, charge consumption, and
  remaining charge.

### Deferred (not in this issue)

  Welding, fuel, Speeders/ships, exploration XP, fog of war, undiscovered hexes,
a large hex grid or full planet map, world coordinates, terrain simulation,
pathfinding, multi-hop routing, route queues, random encounters, fast travel,
teleportation, recalls, Travel cancellation, background workers, WebSockets,
client-authoritative timers, Phaser/canvas/WebGL map rendering, and Inventory/
Equipment overlay polish from issue #41 are all explicitly out of scope here.
