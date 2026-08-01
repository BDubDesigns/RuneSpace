# Gameplay Foundations

This is the authoritative design record for the server-authoritative foundations
introduced in issue #16 and the approved Crash Site Mining slice. It defines
contracts and approved values, not unfinished balance values or future activities.

## Time and actions

- A game tick is exactly 600 milliseconds.
- An action is an ongoing character activity. An attempt is one server-resolved
  outcome after its whole-tick duration elapses.
- Activities define base attempt durations in whole ticks. Player-facing speed
  multipliers divide duration and round upward to a whole tick: 2x speed makes a
  10-tick attempt take 5 ticks.
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
- The initial Mining curve and Crash Site award are approved in the slice below;
  other skills and activities remain deliberately undecided.

## Crash Site Mining slice

The first playable action is infinite Crash Site Ferrite Shale Mining. Its concrete
values live only in `game/config/balance.ts` behind `getEffectiveGameBalance()`:
10 ticks (six seconds) per attempt; 15 Mining XP on success; 1 or 2 shale per
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

## Inventory and equipment

- Fungible items are carried as positive-quantity stacks. Unique items are
  individual instances and may contain mutable state such as current charge.
- A stack and each carried unique instance consume one inventory slot. Compatible
  partial stacks fill before new stacks are created.
- Slot capacity is the sum of equipped container capacities. Carry capacity is
  independently derived from supplied Strength, buff, and equipment
  contributions. Neither derived capacity is persisted.
- Equipped gear, including containers, counts toward carried weight but occupies
  no inventory slot. Containers are unique equipped items assigned through the
  dedicated container-slot namespace; future content supplies stable slot IDs.
  They cannot contain containers.
- Item names, weights, stack limits, maximum charges, container capacities, and
  equipment classification belong to validated typed content, not player rows.

## Approved identities and boundaries

Near-term stable skills are Mining, Metallurgy, Welding, and Strength. Stable
opening item identities are Ferrite Shale, Refined Ferrite, Slag, Crash-Grade
Structural Alloy, Salvage Cutter, and Power Cell. These identities establish no
weights, capacities, charge behavior, rewards, starter loadout, or action.

Mining extracts raw material. Metallurgy refines material and forms alloys.
Welding joins material and repairs structures. Salvage dismantles and recovers
components. Fabrication assembles finished objects. Machining creates precise
components. Salvage, Fabrication, Machining, Speeder Piloting, and Ship Piloting
are documented future skill directions only; they have no persistence
initialization or gameplay in this foundation.

## World and Travel (issues #40 and #47)

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

### The initial three-location world

- **Crash Site** (`crash_site`): the existing infinite Ferrite Shale deposit.
  Mining is the only available activity.
- **Abandoned Processing Yard** (`abandoned_processing_yard`): a dormant
  industrial location. Its future Metallurgy activity is presented as dormant
  only and performs no refining in this issue.
- **DeWhat? Emergency Power Annex** (`dewhat_emergency_power_annex`): an
  adjacent emergency-supply depot. It is directly adjacent to both existing
  locations and is the authoritative renewable source for the daily Power Cell
  allotment below.

All three locations are connected by bidirectional routes. No further locations,
content, or map systems (no world grid, coordinates, procedural generation, fog
of war, or art generation) are introduced by this issue.

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

### Atomic Mining → Travel replacement

When Travel replaces an active Mining action:

1. The character and active-action state is locked.
2. Only Mining attempts already completed before the command are resolved,
   exactly once, and persisted (XP, inventory, history, cursor).
3. Mining stops.
4. Travel begins from the still-current origin to the validated destination.
5. The entire transition is committed atomically.

Mining may never progress during Travel, and the server enforces this
server-side even against a stale or manipulated client.

### Location/activity gating

- Crash Site Mining may start only at the Crash Site while stationary.
- Mining cannot start at the Processing Yard.
- Mining cannot start while Travel is active.
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
- Power Cell boosting or Salvage Cutter consumption remains Issue #24 and is
  not implemented here.

### Deferred (not in this issue)

  Metallurgy, refining, Slag/Refined Ferrite production, Power Cell boosting,
  Welding, fuel, Speeders/ships, exploration XP, fog of war, undiscovered hexes,
a large hex grid or full planet map, world coordinates, terrain simulation,
pathfinding, multi-hop routing, route queues, random encounters, fast travel,
teleportation, recalls, Travel cancellation, background workers, WebSockets,
client-authoritative timers, Phaser/canvas/WebGL map rendering, and Inventory/
Equipment overlay polish from issue #41 are all explicitly out of scope here.
