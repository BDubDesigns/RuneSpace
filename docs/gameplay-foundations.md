# Gameplay Foundations

This is the authoritative design record for the server-authoritative foundations
introduced in issue #16, the approved Ferrite Shale Mining slice, and the Cargo
Hold repair slice in issue #89. It defines contracts and approved values, not
unfinished balance values or future activities.

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
- The initial Mining, Refining, and Welding curves and their awards are
  approved in the slices below; other skills and activities remain deliberately
  undecided.

## Mining slice

Mining is one skill with one attempt loop, and **what is being mined is an
authored source** (`balance.mining.sources`, generalized in #209). A source owns
its item, attempt duration, success curve, yield range and XP; the global rules
— the whole-tick cadence, the Power Cell speed multiplier, the preflight, the
run state — belong to Mining itself. Which source a location offers is that
location's resolved state, never a client claim, and the source a lazily
resolved attempt awards is recovered from the durable action ID.

| Source | Where | Ticks | Success | Yield | XP |
| --- | --- | ---: | --- | ---: | ---: |
| Ferrite Shale | The Jag | 10 | 35% at 1 → 100% at 30 | 1–2 | 15 |
| Galvanite | Deep Jag, once braced | 15 | 35% at 1 → 100% at 40 | 1–2 | 25 |

A charged starter Salvage Cutter halves both under the shared whole-tick ceiling
rule, so Ferrite Shale becomes 5 ticks and Galvanite 8, consuming one charge per
charged attempt and changing neither success chance, XP nor yield.

### Ferrite Shale

The first playable action is infinite Ferrite Shale Mining at The Jag. Its concrete
values live only in `game/config/balance.ts` behind `getEffectiveGameBalance()`:
10 ticks (six seconds) per normal attempt; 15 Mining XP on success; 1 or 2 shale per
success; 100 g shale units with a 10-unit stack limit; and the approved level-1
35% to level-30 guaranteed-success basis-point formula. Failures grant neither
shale nor XP. Server-generated randomness is resolved in the locked action
transaction, so refreshes and retries cannot replay an outcome.

Mining stops before a roll when the minimum yield cannot fit, when its equipped
Salvage Cutter is missing, when manually stopped, or when replaced. New
characters are provisioned once transactionally with one 10 kg MYKEA
SCHLEPPRAUM-8 eight-slot container and the approved 50 kg carry capacity; the
first Salvage Cutter is the Walk It Off mission reward (see `docs/missions.md`).
The equipped Cutter remains required for Mining, whether obtained through that
mission or later means.

The current Mining run is bounded per-character state. Aggregate totals survive
refreshes and stopping; only the latest ten immutable server-resolved attempt
summaries are retained. Starting a genuinely new Mining action resets this run.

## Refining slice (issues #81 and #209)

Refining is one skill, one console and one attempt loop, and **what is being
refined is an authored recipe** (`balance.refining.recipes`). A recipe owns its
inputs, its success output, its failure behaviour, its duration, its curve, its
XP and the Refining level it requires. It also owns its own action ID, for the
same durable-identity reason a Mining source does: the selected recipe survives
refresh and lazy/offline resolution with no new persistence column, because the
active action **is** the selection. This is deliberately not a generic crafting
engine.

| Recipe | Requires | In | Out | Ticks | Success | XP (hit / miss) |
| --- | ---: | --- | --- | ---: | --- | --- |
| Refined Ferrite | 1 | 2 Ferrite Shale | 1 Refined Ferrite | 7 | 40% at 1 → 100% at 20 | 15 / 3 |
| Galvanic Stock | 5 | 2 Galvanite | 1 Galvanic Stock | 10 | 35% at 1 → 100% at 30 | 25 / 5 |
| Galvaferrite | 8 | 1 Refined Ferrite + 1 Galvanic Stock | 1 Galvaferrite | 12 | 35% at 1 → 100% at 30 | 35 / 7 |

Every recipe is visible in the console from the beginning; a recipe the
character's level does not authorize renders as `Requires Refining N` and is
refused server-side, not merely disabled in the browser.

A failure is one of two authored shapes. **Fixed outputs** produce what the
recipe names — 1 Slag for Refined Ferrite, 2 Slag for Galvanic Stock. **One
input returned** hands exactly one of the inputs back, chosen 50/50, and loses
the other; that is the Galvaferrite pour, and it is why the resolution's totals
are item-keyed maps rather than a fixed trio of counters.

The preflight simulates removing every input and then requires each mutually
exclusive outcome to fit independently before any roll is requested, so no
attempt can ever partially commit.

### Refined Ferrite

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

## Cargo Hold repair and Welding slice (issue #89)

Crash Site exposes the damaged ship's Cargo Hold repair. The repair is
character-scoped and persistent: it is not a generic construction system, a
bank abstraction, or a reclaimable deposit.

### Cargo Hold repair introduction (Issues #128 and #148)

An incomplete Cargo Hold shows only a compact **Damaged Cargo Hold** teaser
until the player accepts Mission #4, **Hold It Together**, through Waste Not's
authored continuation. The accepted mission is the authoritative repair-access
signal: it reveals the existing material and Welding controls and authorizes
repair commands. A completed repair remains available even if no Mission #4
row exists, so already repaired Holds and their storage are never invalidated.

The authoritative guards live at the generic repair commands in
`server/repair-commands.ts` and share the same derived access predicate
(`server/repair-access.ts`) as the play-state presentation. Incomplete repair
contribution and Welding start require Mission #4 acceptance; Cargo storage
still requires the repair completion signal (`completedAt`). Row existence,
material progress, and preserved pre-beta partial progress are not unlock
signals. No generic unlock registry is introduced.

Mission #4 observes authoritative Cargo Hold repair completion rather than
owning material consumption or Welding progress. The repair target owns the
**15 Refined Ferrite + 6 Slag** recipe and material consumption; Welding
remains five ticks per increment with **50 Welding XP** per increment and
twelve increments for **600 total Welding XP**. Mission #4 adds a separate
**100 Welding XP** turn-in reward exactly once.

### Repair targets: one Welding system, several jobs (issue #172)

Welding is one skill with one set of global rules — the attempt duration, the
XP per completed increment, and the whole-pass resolution behavior
(`game/config/balance` `welding`). **How much of a particular thing there is to
weld belongs to that thing**, as a per-target recipe under `repairTargets`:

| Repair target | Materials | Increments | Welding XP from the work |
| --- | --- | --- | --- |
| Cargo Hold (Crash Site) | 15 Refined Ferrite + 6 Slag | 12 | 600 |
| Crew Stop (Holo Hollow) | 20 Refined Ferrite | 10 | 500 |
| Deep Jag cave-in | 25 Refined Ferrite + 5 Power Cells | 15 | 750 |

A recipe's materials are an **authored list**, generalized in #209 from the
original Refined-Ferrite-and-Slag pair. Deep Jag's brace wants Power Cells, and
a `power_cells_contributed` column would have meant a new column for every
future recipe; instead `character_repair_targets.materials` is one
`{ itemId: quantity }` map on the same row. That also keeps a contribution a
single atomic row update, which is what makes a retried or concurrent
contribution unable to double-remove carried items. Contribution planning,
projection, Mission repair observation and the UI all derive their rows from
the recipe, so a target wanting a fourth material needs no code at all. A
target may also author a `materialNotes` line per material — what that material
is actually for — which the panels render beside the row.

Every target shares one persistence boundary (`character_repair_targets`, keyed
by character and target), one domain (`game/domain/welding-repair`), one
resolver (`server/welding`), and one set of commands
(`server/repair-commands`). A target is identified at runtime by its own action
ID, so `active_actions` keeps its narrow shape and carries no per-action
payload. Which accepted Mission authorizes an incomplete repair, and where the
work physically happens, are authored content
(`game/content/repair-targets`).

An untouched repair target is simply an absent row, so adding a target needs no
backfill: play provisioning creates nothing, and the first repair command
inserts the row idempotently. A completed repair stays completed and usable
regardless of Mission state.

- Once the authorizing Mission permits repair, the exact recipe is the target's
  own. A contribution command locks the character and carried stacks, caps each
  material to the useful outstanding amount, removes only that exact amount, and
  commits the progress atomically. **Contributions are deliberately partial and
  incremental**: a player may hand over what they carry, leave, gather more, and
  come back, which is what makes the Crew Stop's twenty Refined Ferrite an
  investment made over several trips. The player must confirm the exact
  quantities; installed materials cannot be recovered.
- Once unlocked, Welding is a standard server-authoritative skill. It is
  available only while stationary at the target's own location, after its
  material requirement is complete. Each increment is one whole **5-tick /
  3 second** pass, grants **1 repair progress and 50 Welding XP**, and resolves
  deterministically with no roll. A partial pass consumes no progress or XP.
- Welding uses the normal one-active-action, lazy-resolution, stop, and Travel
  replacement contracts. Completion is a hard stop at the target's increment
  count; no further action or XP can be generated. Travel and other commands resolve only completed
  passes before applying their own transition.
- Once restored, Cargo Hold storage is available only while stationary at Crash
  Site. It has **32 occupied slots** and no aggregate mass limit. Stack deposits
  and withdrawals support one item or the full current stack, are exact and
  all-or-nothing, and preserve stack identity/state. Unique items retain their
  original item-instance identity and mutable state (such as Cutter charge).
  Equipped items cannot be deposited. Withdrawals must fit the carried
  Inventory's authoritative slot and mass limits.
- The storage surface renders occupied entries only; it does not render a 32
  tile empty grid. Cargo Hold has no generic transfer, bank, or multi-container
  abstraction, and no trading of its own: the approved NPC merchant loop
  (below) operates on carried Inventory only.

### Practice Welding: the indefinite training loop (issue #190)

Wade's Workbench at Rusk Recovery is genuine Welding that repeats. It shares the
skill, the **5-tick / 3 second** section cadence, and Clean Pass with every
repair; what differs is that nothing is being fixed, so it pays a reduced share
of the Welding XP and can be done forever.

| Fact | Value | Home |
| --- | --- | --- |
| Input per weld | 2 Scrap Metal, consumed when the weld begins | `balance.practiceWelding` |
| Sections per weld | 10 | `balance.practiceWelding` |
| XP per section | authored share of the global Welding XP (20% → 10, so 100 per weld) | `practiceSectionXp()` |
| Output per weld | up to 2 Slag, at completion time | `balance.practiceWelding` |
| Scrap Metal | `stackLimit: 1`, so one piece per inventory slot | `balance.items.scrapMetal` |
| Where, and what opens it | Rusk Recovery; accepting 10,000 Hours | `game/content/rusk-recovery` |

Practice is deliberately **not** a repair target: a repair target is one finite
physical job that permanently completes. Its durable state
(`character_practice_welds`, one row per character) carries only Practice-owned
facts — the partial weld, whether that weld's two Scrap are already spent, the
persistent Slag preference, the bounded `This Run` totals, and that weld's Clean
Pass roll. An untouched bench is an absent row, so nothing needs backfilling.

- **Availability** derives from the accepted `10,000 Hours` record, exactly as
  repair availability derives from its authorizing Mission, and stays true after
  that Mission completes. There is no `practice_unlocked` flag. Before it holds,
  the bench is scenery: no control, no disabled state, no teaser.
- **One bench, shared.** Since issue #207, Wade's Workbench is also where
  customer Work Orders are welded, and the two are mutually exclusive: a fresh
  Practice weld cannot begin while a client job — or an unfinished Practice weld
  the player has not resolved — already occupies the bench. See "Workbench
  exclusivity" below for the shared rule and its refusal.
- **A continuous run.** One Start begins a weld and each completed weld begins
  the next, consuming its two Scrap at that instant, through the ordinary lazy
  resolution and the standard one-hour offline cap. A run stops itself for one
  of two authored reasons: `out_of_scrap`, when fewer than two Scrap remain
  once the weld in progress finishes (adding Scrap later never auto-restarts
  it), or `finished_current_weld`, when the player has asked the run to end
  after the weld already on the bench — see "Stop After Current Weld"
  below. Every other way a run ends — the player's ordinary Stop, Travel — is
  an interruption, not a resolution, and is recorded as neither.
- **Stop and Resume** preserve the real partial weld: the completed sections,
  the two Scrap already spent, and the rolled Clean Pass positions. Resuming
  costs nothing and works with no Scrap at all. Stop never refunds, never
  produces Slag early, and never rerolls.
- **Travel** stops the bench through the same Practice interruption helper the
  player's own Stop uses (`interruptPracticeWelding`), and Practice is on the
  explicit travel-replaceable action list. There is no remote Welding.
- **Slag at completion time** honours the persistent per-character setting:
  Keep Slag adds as much as ordinary capacity allows and discards only the
  overflow; Auto-discard discards both. Output capacity can never block or fail
  a completed weld.
- **The Mission counts completed welds**, through the same generic
  `tracked_activity` path Mining and Refining use — never sections, starts, or
  Scrap provenance, and including welds resolved lazily while the player was
  away.
- **The yard reads as several panels, not one.** The Location panel carries the
  scene, the description, and Wade himself; the Workbench and the Work Orders
  terminal are sibling panels below it. Since issue #193 the Welding
  progression and `This practice run` are compact rows *inside* the Workbench
  panel rather than panels of their own, and every other location composes the
  same way — see the stationary-Location grammar in `docs/design-system.md`.
  On a phone that keeps Wade's Talk and Trade controls above the shop UI
  instead of below it.

### Clean Pass: a general Welding opportunity (issues #190 and #207)

Every current Welding work unit — a Practice weld, the Cargo Hold repair, the
Crew Stop repair, a customer Work Order — rolls its optional opportunity
sections **once**. The cadence generalized in issue #207 from a fixed pair to a
rule of the work unit's own length, because Work Orders introduced genuinely
variable-length Welding (8 to 19 sections today) and two opportunities on the
longest of them would have been the same mechanic stretched thin.

The rule (`game/domain/clean-pass.ts`, balance in `welding.cleanPass`):

- A work unit shorter than **6 sections** gets none at all — too short for the
  mechanic to mean anything.
- From 6 sections up, it gets **`floor(sections / 5)`** opportunities.
- Nominal windows repeat on a fixed rhythm, each **3 sections** wide, starting 2
  sections in: **2-4, 7-9, 12-14, 17-19**, and so on — one window per opportunity,
  in order.
- The **final** window is the only one that ever moves: it shifts left just far
  enough that **2 ordinary sections** always remain behind the last possible
  opportunity. That is what guarantees a claim can never complete the work
  unit, on *any* length, rather than being an accident of two section counts
  that happened to both leave a tail.

Worked examples: 6 sections → 2-4. 8 → 2-4. 10 → 2-4, 6-8 (the second window
shifted left one to leave two sections after it). 12 → 2-4, 7-9 (no shift
needed). 15 → 2-4, 7-9, 11-13. 18 → 2-4, 7-9, 12-14. 20 → 2-4, 7-9, 12-14,
16-18.

The roll is persisted by the work unit itself, as one JSON array per work unit
(`character_repair_targets.clean_pass`, `character_practice_welds.clean_pass`,
and `character_work_order_postings.clean_pass` all carry the same
`[{ section, outcome }]` shape, replacing the original fixed two-column pair),
and is never rerolled by Stop or Resume. An opportunity is open during exactly
one ordinary Welding section, which makes the open window purely positional:
after reconciliation, `sectionsCompleted + 1` is the section in progress, and
that is what the claim validates against, plus the same small network grace
Scavenge allows.

- A valid claim advances the work **one additional section immediately** and
  pays exactly that section's ordinary XP for the activity — reduced Practice
  XP at the bench, the Work Order share on a customer job, or full Welding XP
  on an authored repair (see "Work Orders" below for the exact shares). It
  changes no material cost and creates no special per-section value.
- Missing one costs nothing. An opportunity welded past, including while the
  player is away, is simply missed and needs no durable write; the work's own
  progress says so.
- Stop and Travel durably close an open window as missed, so resuming the same
  partial work cannot resurrect it. An opportunity still ahead of the work stays
  scheduled.

Clean Pass is deliberately not a generic timed-opportunity engine. Scavenge
stays entirely separate: its window belongs to a Travel leg and resolves against
a loot table. Only conventions are shared — a server-derived window and a small
claim grace.

### Workbench exclusivity and "Stop After Current Weld" (issue #207)

There is one Workbench in Wade's yard, and once a customer's property can sit
on it, "is anything already on it?" has to have exactly one answer
(`game/domain/workbench.ts`). Occupancy is derived, never a pair of independent
flags that could disagree with each other or with the underlying rows:

- **An accepted Work Order occupies the bench.** So does an **unfinished
  Practice weld** — one whose two Scrap are already spent — even after the
  player has Stopped it. A partial weld the player paid for is real work in
  progress, not an idle bench, and starting something else over the top of it
  would silently destroy what they paid for.
- **A conflicting start is refused, never silently overwritten.** Beginning a
  fresh Practice weld while a client job (or a different unfinished Practice
  weld) holds the bench, or accepting a Work Order while an unfinished Practice
  weld holds it, returns an explicit `workbench_occupied` refusal naming what is
  in the way. Nothing is ever bumped off the bench by starting something else.
- **Resuming the same unfinished unit is always allowed.** That unit already
  holds the bench, so continuing it is a different question from claiming the
  bench for something new, and it is never asked to prove the bench is clear.

Because Practice is deliberately continuous — one Start begins a run that keeps
consuming Scrap and rolling straight into the next weld — it otherwise gives the
player no way to leave the bench clear on purpose: ordinary Stop preserves a
partial weld, and simply waiting spends two more Scrap the instant the current
weld completes. **"Stop After Current Weld"** is the third intent that
answers this. It applies only to the weld already on the bench, whether running
or Stopped with partial progress: it records a durable intent
(`character_practice_welds.finish_current_weld`), then starts or resumes so
that weld can actually finish, and clears the bench for a customer job the
instant it does. Resolution lets the weld complete with its ordinary XP,
output, and Clean Pass semantics, starts no next weld, consumes no further
Scrap, and leaves the Workbench clear. The durable intent survives the player
going offline, exactly as the partial weld itself does, and is cleared the
moment it is honoured or the player issues an ordinary Start again.

### Work Orders: paying client jobs on the shared Workbench (issue #207)

Work Orders are repeatable, paying Welding jobs from named clients, offered
through the terminal at Rusk Recovery once **10,001 Hours** is **accepted** —
turning that Mission in afterward changes nothing about the board's
availability. `docs/work-orders.md` owns the board rules, the payout and XP
formulas, the persistence shape, and the authored job pool; this is the
gameplay-level summary of how a Work Order fits the same Welding foundation as
every other kind.

- A Work Order is genuine Welding on the shared Workbench, not a second skill
  or a second timer engine: the same 5-tick section cadence, the same lazy
  resolution and one-hour offline cap, and the same Clean Pass mechanic above,
  scaled to each job's own length (8 to 19 sections in the current pool).
- **Accepting a job is not starting it.** Accepting commits the job's exact
  material recipe from carried Inventory and puts it on the bench, marked In
  Progress; a separate Start/Resume command is the only thing that ever begins
  or continues section timing.
- **One bench, one job.** Accepting is refused while an unfinished Practice
  weld already occupies the bench, under the same Workbench exclusivity rule
  above — a customer's job cannot silently displace work the player already
  paid for.
- **Completion pays Credits and the job's Welding XP**, and immediately refills
  the same board slot from the eligible pool. There is no Abandon: the only way
  an accepted job leaves the bench is finishing it.
- Stop and Travel interrupt a Work Order exactly as they interrupt Practice —
  closing any open Clean Pass window as missed and preserving every resolved
  section — never refunding materials and never completing the job early.

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
  visibility to other players, pickup, and player-to-player transfers remain
  future work; no world object is created by dropping. Selling to an approved
  NPC merchant is a separate authoritative command (see Credits below), not a
  drop or a transfer.
- Inventory Power Cell loading is a convenience route to the same
  server-authoritative `loadSalvageCutterPowerCell` command and transaction the
  Equipment surface uses, via the same `loadPowerCellAction` client action. It
  is enabled only when the authoritative state shows a loose cell, an equipped
  depleted Cutter, and no conflicting command in flight, and it explains the
  reason whenever it is unavailable. Equipment remains the full Cutter
  charge/status surface.

## Credits and merchant transactions (issue #159)

Credits are RuneSpace's character-scoped currency. Product-level rules — the
approved price table, merchant personality, and Trade UX — belong to
`docs/holo-hollow.md`; this section owns the durable mechanical contract.

- `characters.credits` is the single source of truth. It is `NOT NULL`, defaults
  to the approved starting balance for both newly provisioned characters and the
  migration backfill of existing ones, and carries a database CHECK that refuses
  a negative balance regardless of application logic. Clients never submit,
  compute, or cache a balance; the only balance any surface shows is the one
  projected by authoritative play state.
- Merchant catalogs are validated typed content (`game/content/merchants.ts`),
  referenced by stable merchant ID. Prices are authored there — never in JSX,
  command handlers, or request payloads. A trade request carries only intent:
  the owned character, the Local Place, the item, the direction, and a whole
  positive quantity.
- A trade runs on the instantaneous locked-character boundary
  (`withLockedOwnedCharacter`), so an expired Mining or Travel row stays blocking
  until its own command resolves it and can never be progressed as a side effect
  of trading. Under that lock the command re-reads the authoritative balance and
  inventory, re-quotes from content, and applies the Credit change and the
  inventory change in the same transaction. Any refusal — unaffordable,
  insufficient carried quantity, untraded item, invalid quantity, or a purchase
  that will not fit — commits nothing at all.
- Merchant buy/sell reuses the generic carried-inventory boundary
  (`consumeStackableItem`, `planExactStackAddition`, `addStackableItem`) rather
  than any merchant-specific stack rule, so stacking, partial stacks, slot
  capacity, and carried mass behave exactly as everywhere else. A purchase is
  all-or-nothing: a partial fill is never delivered.
- There is no merchant wallet, finite merchant stock, restock timer, dynamic
  pricing, buy limit, or player-to-player exchange.

### World Location merchants (issue #190)

A merchant is authored once and referenced by its venue. A Local Place names the
merchant it hosts (#159); a World Location may do the same, which is how Wade
trades out of his own yard rather than a room in a town. The merchant itself
owns its prices and its authored unlock: `authorizingMissionId` names the
Mission whose **acceptance** opens the counter, revalidated server-side against
the character's own accepted record, and it stays open after that Mission
completes. Wade sells Scrap Metal at 2 Credits with no stock row, restock timer,
or day cap, and buys nothing; Bix's Local Place path is unchanged.

The Trade surface presents only the directions the authored price table
supports, derived generically by `merchantTradeDirections`: a merchant with no
purchase prices is Sell-only, one with no buy prices is Buy-only, and a merchant
who does both keeps the Buy/Sell toggle. With one direction there is no toggle
at all and the heading names it, so Wade's counter never opens an empty Sell
tab. This is read from content, never from which merchant it is, and it is not a
reason to author a price merely to fill a tab.

## Local Places (issue #159)

A Local Place is a place inside one parent World Location — a shop, a municipal
building, an inn. It exists so a settlement can have interiors without inventing
a second geography.

- A Local Place belongs to exactly one parent World Location and has no axial
  coordinate, no adjacency, and no available action IDs of its own. It is never
  a Travel destination and is never modelled as a `LocationDefinition`.
- Entering one changes nothing authoritative: it does not start Travel or a
  Journey, does not award Travel progression, does not create Scavenge, and does
  not move `characters.current_location_id`. The database still says the
  character is at the parent World Location.
- Which Local Place is open is **navigation state, not character state**. It
  lives in the route (the `place` query parameter, alongside the existing
  `surface` parameter) so refresh and browser Back behave sensibly. It is
  deliberately absent from persisted character state and from projected play
  state — there is no second character position to keep in sync.
- Because that state is not authoritative, a server command never treats a
  submitted Local Place as proof of anything. It revalidates: the character is
  owned and stationary, its authoritative World Location is that place's parent,
  the place exists there, its derived access permits entry, and the place
  actually owns the feature being used.
- Access is one derived result (`available`, or locked with a player-facing
  in-world reason) consumed by both presentation and commands. A locked place
  stays visible and says why. Presentation never tests for a particular
  building.
- The authored access rules are a closed three-kind union: `open`, `locked` with
  a reason, and (issue #170) `locked_until_mission_completed` naming one
  Mission. The derivation takes the character's completed Missions and answers
  the same single question, so a world-state unlock **stores nothing of its
  own**: HH B&B opens because `character_missions` says Keep the Change is
  completed, and there is no `bnb_unlocked` flag that could disagree with it.
  Presentation reads those completed ids from the projected Mission state
  (`deriveCompletedMissionIds`); commands re-read them from the database inside
  their own transaction (`loadCompletedMissionIds`), so client navigation still
  proves nothing. Module-load validation rejects a place gating on a Mission
  that does not exist.
- Nesting is one level only. There is no recursive place-within-place engine and
  no generic requirement-expression language; the mission-gated kind above is
  the smallest additional condition #170's real unlock proved necessary.
- A place may host **gameplay of its own** (issue #172): Holo Hollow's Crew Stop
  is the first. That arrives as an activity slot the composition boundary fills,
  exactly as it already selects a World Location's activity — not a plugin
  registry built for one case. The place itself stays presentation. An activity
  owns its own leading spacing, because only it knows whether it has anything to
  show right now; a place whose activity is currently silent leaves no gap.
- A place that something inside it can permanently change authors **both
  states** (`presentation.repaired`), and which one the player sees is derived
  from authoritative repair completion. As with the mission-gated door, the
  visible world change stores nothing of its own: the Crew Stop reads repaired
  because `character_repair_targets` says its repair is finished. Module-load
  validation rejects a place presenting a repair target that does not exist.
- Ordinary World Locations are unaffected: a location with no authored Local
  Places renders and behaves exactly as before.

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
linear success curve. Welding (issue #89) repairs the Cargo Hold at Crash Site
after its exact 15 Refined Ferrite + 6 Slag recipe is installed, using twelve
deterministic 5-tick increments for 600 total XP. Salvage
dismantles and recovers components. Fabrication assembles finished objects.
Machining creates precise components. Salvage, Fabrication, Machining, Speeder
Piloting, and Ship Piloting are documented future skill directions only; they
have no persistence initialization or gameplay in this foundation.

## World and Travel (issues #40, #47, and #83)

RuneSpace's production stages require movement between distinct places. Travel is
a real, server-authoritative, blocking character activity — not an instant tab
switch or a client timer. Issue #40 establishes the smallest correct
world-and-travel foundation on which later Metallurgy, exploration, fog
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

### The local world (issues #83, #159, #190)

- **Crash Site** (`crash_site`): the wreck / starting location after issue #83.
  Cargo Hold Welding is available here after its material gate; no Mining is
  available here, and the existing ship scene image remains unchanged.
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
- **Holo Hollow** (`holo_hollow`, `{q:-1,r:1}`): the first settlement (issue
  #159). Its town places are Local Places, not World Locations.
- **Rusk Recovery** (`rusk_recovery`, `{q:-2,r:1}`): Wade's recovery yard
  (issue #190), immediately northwest of Holo Hollow. Visible and visitable from
  the beginning of the game; it hosts Practice Welding and, once its Mission is
  accepted, Wade's own merchant counter. One static scene before and after
  progression — no locked/unlocked scene swap.

Adjacency after issue #83 (bidirectional, no second graph): Crash Site ↔
Processing Yard, Crash Site ↔ Power Annex, Processing Yard ↔ Power Annex,
**Crash Site ↔ The Long Scramble**, **The Long Scramble ↔ The Jag**, plus Holo
Hollow's edges (#159) and, from issue #190, **Holo Hollow ↔ Rusk Recovery** at
the standard adjacent walk duration. No direct
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
  (origin, destination, and the optional Scavenge state). The active action's
  `started_at` is the sole authoritative travel start time; the current location
  stays the authoritative origin until arrival commits.
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

- Selecting a hex on the local map only inspects/selects it.
- A separate explicit confirmation control ("Walk to … — 24 sec") invokes the
  server-authoritative begin-travel command. The same interaction works in
  reverse after arrival.

### Travel modes and paid transport (issue #172)

A Journey records **how** it is being made (`character_travel_state.mode`), and
that mode owns the two things that differ:

- **duration** — a `walk` is the ordinary 40-tick adjacent leg; the Crew Hauler
  covers the whole authored Holo Hollow → The Jag route in **20 ticks / 12
  seconds**, where walking it is two 40-tick legs through The Long Scramble plus
  a second explicit Travel command at the stop in between;
- **Scavenge eligibility** — only a walk has a Scavenge window. A ride has none
  at all: the travel row stores `NULL`, the projection exposes nothing, and
  `claimScavenge` refuses. A database CHECK ties the two together so the
  invariant cannot be violated by any command.

A paid route is **not map adjacency**. Holo Hollow and The Jag remain
non-adjacent: walking between them is unchanged, the map draws no new walkable
edge, and `planTravel` still refuses the direct walk. The route is authored
content (`game/content/transport-routes`) carrying its origin, its destination,
its mode, its fare, and the completed Mission that unlocks it. The server resolves all of
that from the character's own authoritative position — the browser supplies a
destination and nothing else — and the fare commits in the same transaction as
the Journey under the character row lock, so a retry or concurrent request can
never charge twice and a refusal never charges at all.

A route is **one-way and authored as such**: `originLocationId` and
`destinationLocationId`, never an unordered pair. The Crew Hauler runs Holo
Hollow → The Jag because the crews can make room for a passenger heading out
and cannot on the way back, when the hauler is loaded with shale. Direction is
therefore server-authoritative rather than a hidden button: `getTransportRoute`
answers only for the authored direction, so a The Jag → Holo Hollow request
refuses with `unknown_route` even if it is forged. An opposite direction, if a
later feature genuinely earns one, is a second authored route — never a flag
that makes an existing one reversible. Walking is untouched and remains
available both ways through ordinary adjacency, with its Scavenge windows.

A route also authors **where it is boarded** (`boardingLocalPlaceId`). With an
authored Local Place it is offered inside that place and nowhere else — the
Crew Hauler is boarded at the repaired Crew Stop, never from Holo Hollow's town
surface, because the ride is the crews who use that shelter rather than a
service the town runs. A location that is only some route's destination offers
nothing at all: The Jag has no control to disable and no placeholder explaining
the ride it cannot give. This is presentation authority only: where the player
clicks changes nothing the server checks. A surface asks the same authored
question before it lays out space (`availableCrewHaulerRides`), so a place with
no ride shows no gap where one would have been.

The ride is also not the repair. A finished repair changes the world
immediately — the repaired artwork and copy derive from the repair record
alone — but the route unlocks on the **completed Mission**, so between the last
weld and Renn's turn-in the shelter is visibly fixed and offers no boarding at
all; the ordinary Mission guidance is what leads the player back to Renn.

This is deliberately one fixed route earned by one real feature. There are no
schedules, timetables, waiting queues, transfers, tickets, vehicle ownership,
or pathfinding, and nothing computes "the best way to get somewhere".

### Optional walking Scavenge window (issue #88)

- Each ordinary 40-tick walking leg receives one server-chosen Scavenge start
  tick in the inclusive range **3–30**. The opportunity is open for **5 ticks
  = 3 seconds**, then is permanently missed; arrival, replacement, or any
  future cancellation ends the leg and its opportunity. The server accepts a
  claim for one additional second after the client-visible expiry to absorb
  network delay; this grace does not extend the visible or clickable window.
- Claiming is a server-authoritative transaction. Capacity is preflighted for
  every mutually exclusive maximum branch before one weighted roll; the roll,
  inventory award, and claim marker commit exactly once. The universal table is
  fixed at 10,000 basis points: 750 each for Zilch, Nothing Burger, Nada, and
  Whammy!; 2,000/1,250/750 for Ferrite Shale x1/x2/x3; 750/500 for Power Cell
  x1/x2; and 1,000/750 for Refined Ferrite x1/x2. No-find outcomes award no
  item, XP, or Slag.
- The committed result and the presentation of it are separate. A narrow,
  Scavenge-specific pending-reveal row keeps the committed outcome available
  through refresh, reconnect, navigation, and Travel arrival. The reveal is a
  stable gameplay-level overlay rather than content mounted only inside the
  in-transit panel; Travel continues underneath on its normal schedule. If
  arrival occurs while the reel is spinning, the presentation finishes without
  extending or pausing Travel.
- The vertical reel is presentation-only: each readable panel's height is
  proportional to the authoritative weight, a fixed side pointer marks the
  result, and a repeated weighted strip animates through 2–4 complete cycles
  with cycle-count-scaled duration, bounded variation, and a landing point
  inside the middle 90% of the winning panel. Skip reveal, the persisted
  auto-skip reel-spin preference, and reduced-motion mode bypass animation but
  never alter the committed outcome or disable the optional Scavenge control.
  DONE only acknowledges the presentation; it cannot award, reroll, or change
  Travel and is idempotent.

### Location population (issue #62)

The stationary Location surface shows the other characters currently persisted
at that same location, so the world feels inhabited. The dedicated Map does not
render this population flow; surface ownership is defined in `docs/architecture.md`.

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
- **Presentation:** a compact count indicator on the Location surface plus an
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
  level 1 as the baseline; with Mining, Refining, and Welding published it
  reflects the highest of those. No total-level field is persisted and no
  formula is duplicated in the UI.
- **Skill rows:** each published skill shows its player-facing name (from the
  authoritative skill-presentation content boundary), current derived level,
  total XP, XP earned within the current level, XP required for the next level,
  and an accessible progress meter. All thresholds come from the authoritative
  balance boundary (`skillLevelThresholds` in `game/config/balance.ts`) through
  the shared `skillLevelProgress` domain helper — the same helper the Mining
  state projection uses. At the maximum level the panel shows the level cap and
  total XP truthfully and fabricates no further requirement.
- **Current scope:** Mining, Refining, and Welding each have an approved level
  curve (see `game/config/balance.ts` / `docs/gameplay-foundations.md`) and
  are therefore the published skills. Strength has a persisted starter XP row
  but no approved curve and is not presented. A future approved curve (one
  entry in the balance boundary) publishes that skill automatically — no
  per-skill component or projection branch is needed.
- **Portrait:** the panel renders the character's resolved portrait
  presentation through the shared `components/portraits/CharacterPortrait`
  boundary (see "Character portraits" below): the selected catalog portrait as
  a normal `next/image` derivative, or the neutral system placeholder
  silhouette when no valid selection exists.

### Character portraits (issue #65)

Every RuneSpace character has one deliberate, per-character portrait choice
that is used wherever the character is publicly presented.

- **Selectable set:** the ten `player-starter` entries of the authoritative
  Issue #70 portrait catalog are always selectable. Issue #98's
  `player-unlockable` entries are offered and accepted only when the
  authenticated player account owns the corresponding permanent entitlement;
  the same account-aware rule governs picker projection and safe presentation.
  `npc-only` and `reserved` portraits are valid production assets but are never
  offered or accepted, and an unowned unlockable resolves to the neutral
  placeholder. Availability is catalog metadata plus the server-loaded
  ownership set — never asset paths or client-provided categories.
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
  request, validates the ID through the shared player-aware rule, verifies
  ownership on every change, and updates only the requested owned character
  with an atomic ownership-scoped statement. `npc-only`, `reserved`, unknown,
  malformed, retired, and unowned unlockable values are refused; concurrent or
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

When Travel replaces an active travel-replaceable work action (Mining, Refining,
or Welding):

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
- The Long Scramble has no local gameplay activity or resource; it is not shown
  as Offline or given filler controls. Crash Site exposes only the approved
  Cargo Hold repair/storage surface and no Mining controls.
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
- The mechanic above is unchanged by issue #170, which only added the
  worldbuilding around it: the depot is surviving S.S.A.-required
  emergency-continuity infrastructure from Holo Hollow's tourism era, and the
  per-person daily limit exists for fair emergency access. That canon lives in
  `docs/holo-hollow.md`; no ration system, quota model, or new daily
  persistence was introduced.
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

  fuel, Speeders/ships, exploration XP, fog of war, undiscovered hexes,
a large hex grid or full planet map, world coordinates, terrain simulation,
pathfinding, multi-hop routing, route queues, random encounters, fast travel,
teleportation, recalls, Travel cancellation, background workers, WebSockets,
client-authoritative timers, Phaser/canvas/WebGL map rendering, and Inventory/
Equipment overlay polish from issue #41 are all explicitly out of scope here.
