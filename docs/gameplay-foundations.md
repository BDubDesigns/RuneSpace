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
- A gameplay award that raises a level past one or more recipes'
  `minimumLevel` sends one grouped, read-only System notice naming every recipe
  it unlocked, skipped levels included, in the award's own transaction (#274;
  `docs/architecture.md`). The operator's SET TOTAL XP repair sends none.
- The initial Mining, Refining, and Welding curves and their awards are
  approved in the slices below, as are Fabrication (#232) and Runeworking
  (#391) on the same standard curve; other skills and activities remain
  deliberately undecided.

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
| Oil Shale | The South Cut and Stillreach's The Dry Seam (#380), **Mining 5** | 100 | 35% at 1 → 100% at 50 | 2–4 (1 on a low yield) | 100 (20 on a low yield) |
| Stone | Stillreach's Prospecting Quarry | 33 | 35% at 1 → 100% at 30 | 1–2 (a miss awards nothing) | 45 |
| Rune Fragment | Stillreach's Harmonic Workings (#383), **Mining 8** | 75 | 35% at 1 → 46.66% at 8 → 100% at 40 | 1–2 (a miss awards nothing) | 130 |

Every source also authors a `requiredMiningLevel` (the personal access gate; 1
for The Jag and Deep Jag, so neither is newly gated) and a `lowYield` (`null` for
those two, whose miss still awards nothing).

**The Mining tool is authored too (#233).** Whichever Cutter is in the one
Mining-tool slot supplies its own requirement, charge ceiling, permanent
duration multiplier and **charged effect** through the equipment-definition
boundary (see "Inventory and equipment"). A charged effect is one of two closed
identities: `speed` — the one global Power Cell speed multiplier, applied to the
tool's duration under the same whole-tick rounding — or `extra_yield` — ore
added to each charged attempt that produces primary ore. Never both.

| Tool | Requires | Duration, uncharged | Duration, charged | Charge | Charged ore |
| --- | --- | --- | --- | --- | --- |
| Salvage Cutter | Mining 1 | 1.00× — Ferrite 10, Galvanite 15 ticks | `speed`: ÷2 — 5 / 8 ticks | 10 per Cell | ordinary: Ferrite and Galvanite 1–2, Oil Shale 2–4 (low yield 1) |
| Loadsteel Cutter | Mining 5 | 0.8× — 8 / 12 ticks | unchanged — 8 / 12 ticks | 10 per Cell | `extra_yield`: +1 on any attempt that yields ore — Ferrite and Galvanite success 2–3 (a dead miss stays empty), Oil Shale success 3–5, **low yield 2** |

A charged Salvage Cutter is faster attempts (better Mining XP per hour); a
charged Loadsteel Cutter is more ore per attempt that yields ore (better ore and
Power Cell efficiency). At Mining 5 with unrestricted capacity a charged
Loadsteel averages about 28.06 Oil Shale over ten attempts (22.09 before #342's
low-yield bonus), while a charged Salvage Cutter stays faster per unit of time. A charged attempt consumes one charge whether it
succeeds or fails, and one Cell still funds ten charged attempts. Neither tool's
charge changes success chance or the XP an attempt pays (a charged low yield is
still exactly 20 XP). The Loadsteel Cutter's extra ore is an **optional bonus,
never a minimum**: it is added to the attempt's ordinarily resolved ore (a
success's rolled yield, or a low yield's one) and retained as far as capacity
allows, down to the ordinary amount. A source whose miss awards no ore (The Jag,
Deep Jag) gives a charge nothing to add to, so a charged dead miss stays empty.
No room for the bonus keeps the ordinary result, and an attempt is never
refused or shortened because only its bonus does not fit. Depleted, a Loadsteel Cutter keeps its permanent 0.8× and loses only
the extra ore. Below its Mining 5 requirement a Loadsteel Cutter can neither be
equipped nor used: Mining treats it as no usable tool.

### Ferrite Shale

The first playable action is infinite Ferrite Shale Mining at The Jag. Its concrete
values live only in `game/config/balance.ts` behind `getEffectiveGameBalance()`:
10 ticks (six seconds) per normal attempt; 15 Mining XP on success; 1 or 2 shale per
success; 100 g shale units with a 10-unit stack limit; and the approved level-1
35% to level-30 guaranteed-success basis-point formula. Failures grant neither
shale nor XP. Server-generated randomness is resolved in the locked action
transaction, so refreshes and retries cannot replay an outcome.

Mining stops before a roll when the minimum yield cannot fit, when no usable
Mining Cutter is equipped, when manually stopped, or when replaced. New
characters are provisioned once transactionally with one 10 kg MYKEA
SCHLEPPRAUM-8 eight-slot container and the approved 50 kg carry capacity; the
first Salvage Cutter is the Walk It Off mission reward (see `docs/missions.md`).
The equipped Cutter remains required for Mining, whether obtained through that
mission or later means. A resolution always reads the tool actually in the slot
under the character lock, and changing the tool mid-run resolves any due work
with the old one and then stops the run (`mining_tool_replaced`), so no refresh
or offline resolution can apply one Cutter's effects to another (#233).

The current Mining run is bounded per-character state. Aggregate totals survive
refreshes and stopping; only the latest ten immutable server-resolved attempt
summaries are retained. Starting a genuinely new Mining action resets this run.

### Oil Shale at The South Cut (#342) and The Dry Seam (#380)

**The Dry Seam (#380).** Stillreach's The Dry Seam (axial (3,0), adjacent only to
The Survey Line) lists the same `ACTION_IDS.oilShaleMining` in its
`availableActionIds`, with a `Mining` map status. There is exactly one
`balance.mining.sources.oilShale` entry, one resolver and one set of numbers
below for both mines: no location-specific source, copied constant or second
timer. Authorization is the same physical-location check as everywhere:
`loadLocationState` for the character's *stored* location must list the action,
so a character anywhere else on either planet is refused
(`mining_unavailable_here`), and Mining 5 is enforced before any action row,
time, roll or XP exists. Run history and the Motherlode Slab's ULTRA RARE FIND
line name the character's actual location, so a Dry Seam slab reads "at The Dry
Seam". No migration is needed: the action is derived from authored content, and
no schema or stored state changes. The Last Leg terminal's existing 6 Credit
Oil Shale buyback (#375) is how the haul is sold. The rest of this section
describes The South Cut; every rule applies unchanged at The Dry Seam.

Skatboll's first dedicated fuel-supply source, and the first source with a
**personal Mining level gate**. It is one more `balance.mining.sources` entry
read by the one resolver — not a second engine — so the existing Cutters, Power
Cell charge, boosting, run history, active-action identity and lazy/offline
resolution all apply unchanged.

- **Where.** The South Cut, axial (0,3): a close, reinforced entrance cut into
  black laminated oil shale. It is reached only over the travel-only **South
  Access Track** (0,2), which is the Crash Site's southern neighbour: Crash Site
  ↔ South Access Track ↔ The South Cut, two ordinary **40-tick / 24-second**
  walking legs (48 seconds one way). Those two edges and their reverses are the
  only edges this adds; the Track hosts no Mining, shop, NPC, Refining,
  Fabrication, stash, repair or workstation, and eligible walking Scavenging
  applies on both legs. The planned freight pad (1,1) and any shortcut are later
  slices.
- **Access.** Mining 5, enforced by the server when a run starts
  (`miningSourceUnlocked`, read from the character's stored Mining XP): a Mining
  4 character is refused with `miningError: "mining_level_required"` before any
  action, time, roll or XP exists, however the request arrived. The gate does
  **not** move the curve's anchor: success is interpolated from level **1**
  (35%) to a guaranteed **Mining 50**, so Mining 5 is **40.30%** under the
  shipped integer basis-point formula (Mining 4 would be 38.97%).
- **Item.** Oil Shale: **600 g**, stacks to **5**. A normal attempt is **100
  ticks (60 seconds)** before the equipped tool's and Power Cell's modifiers.
- **Full success** (roll under the chance): uniformly **2, 3 or 4** Oil Shale
  from **one** integer draw, plus **100** base Mining XP. A charged Loadsteel
  Cutter adds its +1 (3–5), only as capacity allows.
- **Low yield** (roll at or above the chance): exactly **1** Oil Shale and **20**
  Mining XP — not zero ore and zero XP. It is still an unsuccessful attempt (it
  counts under "low yield" in the run, never "successful"). It never rolls a
  Secondary Find. A charged Loadsteel Cutter adds its +1 here too (a charged low
  yield is **2** shale when that fits, otherwise the ordinary 1), the XP stays
  exactly 20, and the attempt consumes exactly one charge. Both capacity modes
  apply to the bonus the same way: it is retained only if it fits.
- **Secondary finds** (true successes only, one mutually exclusive roll of 300):
  **Uncut Sapphire 1/20** (the existing item and its intrinsic +30 XP, **no**
  public announcement from this mine; Deep Jag's own announcement is unchanged),
  **Motherlode Slab 1/100** (+150 XP, **ULTRA RARE FIND**), **Rune Fragment 1/6**
  (+20 XP, not announced; #367), and **nothing** otherwise (232 of 300).
  A full success with a slab is 250 Mining XP (100 + 150), with a Sapphire 130,
  with a Rune Fragment 120. A low yield never rolls any of them. The Fragment
  was appended last, so the Sapphire and Slab spans and chances are unchanged.
- **Motherlode Slab.** One unbroken specimen, **12,000 g, stack limit 1**,
  `ultra_rare` presentation. It is not a new Mining primary. **Not** implemented
  here, by decision: breaking a slab into Oil Shale, housing or display use,
  dedicated NPC pricing or sale, fuel Refining, canister Fabrication, ship
  travel or refuelling.

#### Prioritize primary resources (#342)

A **character-specific, persistent, server-authoritative** setting
(`characters.prioritize_primary_resources`, **Off by default**), changed only by
`setPrioritizePrimaryResourcesPreference` for the owned character and read under
the character lock whenever Mining resolves, including a lazy or offline window.
Due work resolves under the setting it was earned under; a change applies to
attempts that resolve after it. It governs **every** authored source, and its
whole meaning is the capacity check:

| | **Off** (protective default) | **On** (explicit opt-in) |
| --- | --- | --- |
| An attempt may begin when | room for the source's **minimum full-success primary yield** (2 Oil Shale) **plus any one** possible find (a Sapphire *or* the 12 kg Slab) | room for **one** primary ore |
| Otherwise | refused **before** time, roll or XP, with the existing accurate slots / mass stop reason | refused only if not even one primary fits |
| A full success keeps | the rolled yield, shrinking toward the source minimum only as far as it must for a rolled find to keep its place | as much of the rolled yield (plus a charged bonus) as fits, **down to one**; classification and the full 100 XP stand |
| A rolled find | always has room, by the preflight | gets only the capacity left **after** the primary; if it does not fit it is **silently forfeited** |

A forfeited find earns **no** secondary XP, item, history entry, result tile,
System line or achievement credit, and is not available to claim later: only
items and XP actually committed are persisted. It is never rerolled, swapped for
a find that would fit, or biased by capacity — the find is always drawn, and the
placement happens after. The setting's label and help text say that **rare and
even Ultra Rare finds can be permanently forfeited when storage is full**. A
Ferrite Shale or Galvanite attempt is unchanged except that On lets it start on
one free slot where Off would have wanted room for a find too.

### Secondary Finds (#308)

A source may author a **Secondary Find table** (`secondaryFinds` on its
`balance.mining.sources` entry): bonus items a successful extraction can turn
up *beside* the source's own ore, never instead of it. "Secondary Find" is the
design and system term, "Secondary Find Chance" the stat/modifier term, and
**RARE FIND** is the player-facing treatment shown when one actually drops.

| Source | Find | Chance per success | Bonus XP | Announced in General |
| --- | --- | ---: | ---: | --- |
| The Jag | Uncut Quartz | 1 / 40 | +10 | no |
| The Jag | Uncut Topaz | 1 / 60 | +20 | **yes** |
| Deep Jag | Uncut Topaz | 1 / 35 | +20 | no |
| Deep Jag | Uncut Sapphire | 1 / 55 | +30 | **yes** |
| The South Cut (#342) | Uncut Sapphire | 1 / 20 | +30 | no |
| The South Cut (#342) | Motherlode Slab | 1 / 100 | +150 | **yes**, as ULTRA RARE FIND |
| The Jag (#367) | Rune Fragment | 1 / 25 | +20 | no |
| Deep Jag (#367) | Rune Fragment | 1 / 8 | +20 | no |
| The South Cut (#367) | Rune Fragment | 1 / 6 | +20 | no |
| The Dry Seam (#380) | Uncut Sapphire, Motherlode Slab, Rune Fragment | as The South Cut (1 / 20, 1 / 100, 1 / 6) | +30, +150, +20 | Slab only, as ULTRA RARE FIND naming The Dry Seam |
| Prospecting Quarry (#379) | Rune Fragment | 1 / 4 | +20 | no |
| Prospecting Quarry (#379) | Uncut Quartz | 1 / 6 | +10 | no |
| Prospecting Quarry (#379) | Uncut Topaz | 1 / 12 | +20 | no |
| Prospecting Quarry (#379) | Boulder | 1 / 200 | +150 | **yes**, as ULTRA RARE FIND |

- **One mutually exclusive roll.** Only a *successful* extraction rolls, once,
  over the whole table. Chances are absolute (1 / `oneIn`) and exact: the roll
  is an integer drawn from the least common multiple of the table's
  denominators (600 at The Jag, 3,080 at Deep Jag, 300 at The South Cut and The Dry Seam, 600 at the Prospecting Quarry), and each entry owns a
  consecutive span of it. The Rune Fragment is appended last to each table, so
  every existing gem keeps the span, and therefore the absolute chance, it had. One roll can therefore never award two finds, and no
  authored chance is rounded to basis points. Current content awards at most one
  find per success; the resolver does not encode that limit.
- **XP.** The source still owns its primary XP. Each find *item* owns one
  intrinsic bonus Mining XP (`secondaryFindMiningXp` on its item definition),
  so Topaz is +20 wherever it appears and no source restates it. A Jag Topaz hit
  is 15 + 20 = **35** Mining XP, a Deep Jag Topaz hit 25 + 20 = **45**. An
  attempt records one combined `xpAwarded`.
- **Items.** Uncut Quartz, Topaz and Sapphire are 100 g, stack to **2**, and Bix
  buys them at **8 / 18 / 35** Credits. Wade does not. Their flavour text is
  authored in `game/content/item-presentation.ts` and shown in Inventory details.
  The Rune Fragment (#367) is a 200 g item that stacks to **10**, with its own
  `secondaryFindMiningXp: 20`, no rarity, no announcement and no merchant price;
  see "Rune materials" below.
- **Capacity.** Before an attempt begins, the inventory must be able to keep the
  source's *minimum* primary yield **plus any one possible find**. Finds are
  mutually exclusive, so each candidate is planned independently against the
  same snapshot: one free slot can serve whichever find turns up (no slot per
  possible item), and an existing partial stack satisfies either side. The 200 g
  Rune Fragment is the heaviest candidate, so the Off-setting mass check at The
  Jag is 100 g of Shale plus 200 g (300 g), and at Deep Jag 400 g plus 200 g. A rolled
  find is **never rolled and then discarded**: on a hit with tight capacity the
  find and the minimum ore are kept, and only the optional ore above the minimum
  (and a charged tool's extra ore) is reduced.
- **Charged tools.** A charged Loadsteel Cutter's +1 is *primary ore only*, on
  any attempt that yields ore; it never duplicates a find, and a low yield rolls
  none. A future cutter may modify Secondary Find Chance or
  yield explicitly, but that is not coupled to the primary-yield bonus.
- **Run history.** A run's totals stay item-keyed ("Ferrite Shale gained",
  "Uncut Topaz found") with one combined Mining XP total.
- **Announcements.** An entry's `announce` flag is authored per source and per
  find. When it is set, a successful find posts a public **System** line to
  General — see "Public System messages" in `docs/architecture.md` and
  "Chat" in `docs/design-system.md`.
- **Presentation.** The result's rewards are the ore, each find in resolved
  order, then the combined XP last, in a wrapping equal-width reward grid
  (`components/ui/RewardGrid.tsx`). The gems are authored as `rare` item
  presentation (`docs/design-system.md`, "Item rarity"), so they read as rare
  in Inventory too; the RARE FIND label belongs to the General System line only.
  The Motherlode Slab is `ultra_rare` (#342): the same shared visuals add the
  reusable Ultra Rare shimmer, and its System line reads ULTRA RARE FIND.
- **Capacity under Prioritize primary resources (#342).** The Off rule above is
  the default. With the character's setting On, only one primary ore must fit,
  the primary is placed first, and a rolled find that no longer fits is
  forfeited without XP, history or announcement — see "Prioritize primary
  resources". A find is announced only when it was actually committed.

### Rune materials (#367)

The first, self-contained slice of the Beginner Runeworking work: two ordinary
physical materials and one Inventory action. There is **no** Runeworking skill,
recipe, Echo Seeker, Mission, merchant price or new location here; those arrive
with Slice H ("Runeworking at the Resonance Rig", #391).

| Item | Unit mass | Stack limit | Where from |
| --- | ---: | ---: | --- |
| Rune Fragment | 200 g | 10 | Mining Secondary Find: 1 / 25 at The Jag, 1 / 8 at Deep Jag, 1 / 6 at The South Cut and The Dry Seam, 1 / 4 at the Prospecting Quarry; Break Apart |
| Runestone (intact) | 1,000 g | 5 | **No natural source yet.** An authorized admin grant, until a later source is authored |

Both are ordinary stackable, tradable, carriable materials classified under
*Ores & Gemstones*, authored once in `game/config/balance.ts` (`items`, with the
Fragment's `secondaryFindMiningXp: 20`) and presented in
`game/content/item-presentation.ts`. Their approved art masters are
`assets/item-art/rune-fragment.png` and `runestone.png`; the runtime derivatives
are `public/item-art/rune-fragment.webp` and `runestone.webp`.

- **Mining.** The Fragment is one more entry in the existing single, mutually
  exclusive Secondary Find table of each source (see "Secondary Finds"): a
  success finds at most one of the source's gems, Slab or Fragment, in addition to the
  ordinary ore, and a failed extraction rolls nothing. A charged Loadsteel
  Cutter's +1 stays primary ore only. A Fragment the character's
  *Prioritize primary resources* setting forfeits (no room, setting On) earns
  no item and no +20 XP.
- **Inspect and the Mission offer (#369).** A carried Rune Fragment stack
  and an intact Runestone stack each offer the Mission *Not From Around Here*
  through their ordinary Item Details. While the Mission is unaccepted the tile
  carries the shared blue Mission-available treatment (with the artwork alone
  doing a small intermittent hop, off under reduced motion), and the
  content-authored **Inspect** action opens a compact **New mission** modal with
  the item's own art and the authored copy. Closing it changes nothing; **Start
  mission** stamps the one Mission without consuming, reserving or transforming
  either item and clears the offer from both. A Cargo Hold or stash stack offers
  nothing. This is a generic item-offer mechanism
  (`MissionDefinition.itemOffer`, `docs/missions.md` §4.1), so no Inventory code
  names the Fragment. Break Apart and Drop on a Runestone are unchanged.
  Since #389 the Wise Old Enby at Hilltop Workshop also makes the same offer in
  person (**Show strange mineral**) to a visitor carrying either stone, and
  completes the Mission; see `docs/missions.md`, "Not From Around Here".
- **Break Apart** is the one conversion (`balance.runeMaterials.breakApart`:
  1 Runestone → 5 Rune Fragments, 1,000 g either way). It is offered in the
  Runestone stack's ordinary Item Details, with an irreversible confirmation;
  there is no tool, location, timer, XP or Inspect screen. It converts **one**
  stone from the selected stack, never the whole stack, and nothing reassembles
  Fragments into a Runestone.
- **Authority.** `breakApartRunestone` (`server/inventory.ts`) runs under the
  shared character lock after due Mining resolves. It loads the carried stacks
  and room, and plans with `planBreakApart` (`game/domain/rune-materials.ts`),
  which owns only the authored ratio and the selected-stack precondition (the
  row exists, is a Runestone, and still holds the confirmed quantity). The
  capacity mechanics are the shared hypothetical inventory in
  `game/domain/working-inventory.ts`, as Fabrication, Tinkering and player-trade
  settlement use it: `removeFromStack` consumes the **selected** row (the stone's
  slot frees only if it was the last stone; its mass frees either way),
  `addStackExact` merges the Fragments into partial stacks before taking a slot,
  and `workingInventoryDiff` yields one carried-stack diff that
  `applyCarriedStackDiff` applies in the one transaction. Any shortfall (slots,
  mass, a stale or missing selection, a stack that is not a Runestone) refuses
  with no write, and a failure while writing rolls the whole transaction back. A
  double click, replay or concurrent request is serialized by the character lock
  and re-validated against the confirmed quantity, so a stone can be consumed
  only once. A later Inventory transformation composes the same primitives
  rather than adding another planner.

## Bounded runs (issue #229)

Where the player chooses how long a repeatable run should be before starting,
RuneSpace uses **one** interaction: `− · 5 · + · Max`. The selection starts at
**1**, **− / +** step a number by one, and **Max** is its own choice.

- **A number is a bounded run**: attempt up to exactly that many, unless the
  activity naturally becomes unable to continue first. + stops at how many
  units the inputs carried right now pay for (`affordableBatches` /
  `affordableWelds` in the play state). Start revalidates the number against
  that count inside the character lock; a number authoritative state no longer
  supports is **refused, never silently shortened** — the refusal carries the
  fresh count and the player chooses again.
- **Max is a run-until-blocked mode, not a number.** Start requires only that
  one unit can begin now. The activity's ordinary resolver then re-evaluates
  real authoritative state after every attempt or weld and continues while
  another can begin, so a Max run's final length depends on the actual results
  and inventory. Nothing predicts it ahead of time, and the browser never
  shows a number for it.

Refining and Practice Welding use it today; it is the selection language later
production skills reuse.

| Fact | Home |
| --- | --- |
| Selection rule (default, step, revalidation, allowance, progress, durable form) | `game/domain/bounded-run.ts` |
| Structural bounds (1 .. 999) and the Max literal | `BOUNDED_RUN_MINIMUM_QUANTITY` / `BOUNDED_RUN_QUANTITY_CEILING` / `BOUNDED_RUN_MAX` in `game/config/foundations.ts` |
| Request shape (`number` or `"max"`) | `BoundedRunSelectionSchema` in `game/schemas/gameplay.ts` |
| Selector and active-run progress | `features/shared/BoundedRunControl.tsx` |
| Refining affordable count | `refiningAffordableBatches` in `game/domain/refining.ts` |
| Practice affordable count | `practiceAffordableWelds` in `game/domain/practice-welding.ts` |

The durable state is one nullable integer on each activity's existing row —
`character_refining_state.run_selected_attempts` and
`character_practice_welds.run_selected_welds` — next to the run counter that
already existed (`run_attempts`, `run_welds`). A number is the selected count;
**`NULL` is Max** (migration `0029`), so refresh, lazy/offline resolution and
server-side continuation all know which mode the run is in. Remaining is the
difference and is never stored. `active_actions` is unchanged and still the
one-active-action boundary; lazy/offline resolution and the one-hour cap are
unchanged.

A number that is fully attempted stops the run with its own `run_completed`
reason, checked before the activity's shortage reasons (inputs, capacity,
Scrap), so a run that reaches its number ends by saying it finished rather than
that it ran out. A Max run never reports `run_completed`: it ends with the
ordinary reason that stopped the next unit. Practice's explicit Stop After
Current Weld intent is checked first and keeps its own reason. Only the current
unit is ever committed: the next batch or weld is revalidated as it begins, and
a run that cannot begin its next unit — because of an inventory change mid-run
or, for Refining, its own outcomes — stops with its ordinary reason.

The ceiling (999) is only an internal guard on a Max run, so a defect can never
keep one going forever; it is not what Max means. Carried inventory ends every
real run far below it. If a Max run ever reaches it, the run stops with its own
`run_safety_limit` reason rather than presenting it as ordinary completion or
as running out.

## Refining slice (issues #81, #209 and #229)

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
| Slag (from Shale) | 5 | 2 Ferrite Shale | 1 Slag | 6 | deterministic | 3 / — |
| Slag (from Galvanite) | 5 | 2 Galvanite | 2 Slag | 8 | deterministic | 5 / — |
| Full Small Fuel Canister (#343) | 8 | 10 Oil Shale + 1 Empty Small Fuel Canister | 1 Full Small Fuel Canister | 60 | 35% at 1 → 100% at 30 (50.68% at 8) | 100 / 20 |

The two **deliberate Slag** recipes (#229) are utility processing, not
training: each mirrors its productive recipe's failure output and pays that
failure's XP, and both are gated at Refining 5 so the opening Cargo Hold arc
still teaches Slag as a byproduct. A deterministic recipe authors no success
curve and no failure path (`failure: { kind: "none" }`), never consults the
random source, and its attempts are marked `deterministic` so no surface shows a
roll.

**A run is a number of attempted batches, or Max** (see "Bounded runs"). A
failed attempt counts toward a number exactly like a success. The most a number
may ask for is `refiningAffordableBatches`: whole batches of the recipe's
inputs carried right now. It deliberately ignores capacity and anything a
failure might hand back; capacity is the ordinary preflight's question, asked
before every attempt.

A Max run resolves each real attempt, applies its actual output or returned
input, and runs the ordinary preflight again, continuing while another attempt
can start. Nothing explores future outcomes: a Galvaferrite failure that hands
back an input simply leaves that input carried for the next preflight, so the
same inventory can make a different number of attempts under different rolls.
It stops with the ordinary `insufficient_inputs`, `inventory_slots_full`, or
`carried_mass_capacity_reached` reason. Nothing is fabricated, and the RNG is
unchanged.

Persistence writes the resolver's final stack state — updated, deleted and
created stacks — rather than replaying the window's gross input and output
totals. Within one resolution window a returned input can be spent again by a
later attempt, so gross use can exceed what was ever carried at once; the
resolver's end state, computed under the same transaction's row locks, is the
authoritative inventory.

The console has two views (#239), mirroring the Fabrication Station's split,
through the pure rules in `features/refining/refining-lists.ts`:

- **Refine** answers "what can I refine right now?": level-unlocked recipes
  whose materials are carried for one batch, as selectable output-item tiles
  (the canonical item visual, shared with the station as
  `features/shared/RecipeTile.tsx`), plus any recipe a Mission is guiding,
  shown with what it is missing, so guidance never points at a hidden recipe.
  Unavailable recipes are not listed above the run controls, and there are no
  list filters. While a run is under way the list gives way to the run.
- **Recipes** is the read-only catalog of every recipe the character's Refining
  level unlocks, carried materials or not; nothing above the character's
  level. The public Wiki remains the whole skill's reference.

A recipe the character's level does not authorize is still refused
server-side, not merely hidden in the browser. A failed attempt's Slag or
returned input is presented as what the failure left — headed as a failure and
labelled `produced by` / `returned by the failed attempt` — never as the
recipe's crafted output.

A failure is one of two authored shapes. **Fixed outputs** give what the
recipe names — 1 Slag for Refined Ferrite, 2 Slag for Galvanic Stock, or (#343)
exactly 5 Oil Shale and the Empty Small Fuel Canister back for the fuel recipe.
Whether a fixed output is *made* or *returned* is derived from the recipe, never
from an item ID, by one rule: `partitionFailureAwards` in `game/domain/refining.ts`
(the attempt copy applies it to the attempt's own consumed list; the public
reference to the recipe's authored inputs). An output that is also one of the
inputs is a returned input. Only Slag a failure
makes is a byproduct, so a returned input is always a preserved award that gates
the attempt and that Auto-discard Slag can never discard. **One input returned** hands exactly one of the inputs back,
chosen 50/50, and loses the other; that is the Galvaferrite pour, and it is why
the resolution's totals are item-keyed maps rather than a fixed trio of
counters.

The preflight simulates removing every input and then requires each mutually
exclusive outcome's **preserved** awards to fit independently before any roll is
requested, so no attempt can ever partially commit. A success output and an
input a failure hands back are preserved; a failure's **byproduct Slag** is not
(#256, below).

#### Byproduct Slag and Auto-discard Slag (#256)

Slag a *failure* leaves behind is optional inventory, never a prerequisite for
refining. `refiningAwardFacts` marks each award `byproduct` by where it comes
from, not by item ID: only the Slag of a `fixed_outputs` failure (Refined
Ferrite, Galvanic Stock) is a byproduct. A success output is never one — so the
two deliberate Slag recipes keep their Slag as an ordinary, capacity-checked
output — and neither is the input a Galvaferrite failure hands back.

- The preflight requires room for preserved awards only. A player can start and
  continue an attempt whose failure Slag has no slot or mass capacity, and a
  failure still completes the attempt: inputs consumed, failure XP awarded,
  cursor advanced, and the run counts it like any other attempt.
- After the attempt resolves, byproduct Slag is added with the same partial
  stack planner Mining uses: **Auto-discard Slag Off** keeps as much as
  ordinary slot/mass capacity allows and discards only the overflow;
  **On** discards all of it. The attempt is otherwise identical either way.
- What was produced but not carried is recorded, never folded into what was
  gained: each attempt carries `discarded` (omitted when empty, so attempts
  saved before #256 read as discarding nothing) and the run carries
  `outputsDiscarded` (`character_refining_state.run_outputs_discarded`).
  Result and history copy says "discarded", and the latest-attempt tiles show
  only what reached inventory.
- Kept Slag does take real capacity, so a later success can find no room for
  its product and stop the run with the ordinary `inventory_slots_full` /
  `carried_mass_capacity_reached` reason. That is the product's capacity rule
  working as written; Slag room alone never stops a run.

**The preference is one value per character**, shared with Practice Welding:
`characters.auto_discard_slag` (default Off), written only by
`setAutoDiscardSlagPreference` (`server/character-preference-commands.ts`) and
projected once as `PlayGameplayState.autoDiscardSlag` — neither the Practice nor
the Refining projection carries a copy. Both consoles render the same
`features/shared/AutoDiscardSlagToggle.tsx`, latched in `primary` because it
belongs to no single skill. It is read when work resolves, inside the
character's transaction, so flipping it applies to attempts (or welds) that
resolve after the change; work already due resolves first under the value it
was earned under. Migration `0031` moved each existing Practice choice onto its
character and dropped `character_practice_welds.auto_discard_slag`. Tinkering's
separate `Auto-discard Scrap` remains its own setting.

### Refined Ferrite

Processing Yard Refining consumes exactly 2 Ferrite Shale per attempt and
produces one server-authoritative result: 1 Refined Ferrite (150 g, stack limit
5) plus 15 Refining XP on success, or 1 Slag (150 g, stack limit 10) plus 3
Refining XP on failure. The success chance is 40% at Refining level 1,
increasing linearly to 100% at level 20 and clamping thereafter
(basis-point integer math, server-authoritative roll). One attempt takes
exactly 7 ticks (4.2 seconds); there is no speed boost for Refining.

Refining is available only while stationary at the Abandoned Processing
Yard (or, from #381, inside Stillreach's Refiner-To-Go at 3x duration). Travel generalizes so that starting Travel while Mining or Refining is
active resolves only already-completed work exactly once, persists it
atomically, discards any partial attempt, stops the work action with
`action_replaced`, and begins Travel. The preflight for each attempt
simulates removal of the 2 shale and validates that the resulting inventory can
accept the 1 Refined Ferrite a success produces (stack/mass/capacity); if it
would not fit, no roll is made. The failure's Slag is optional (#256) and never
gates the attempt. All input removal, output addition, XP, run
history, and cursor changes commit atomically.

The refining run mirrors Mining: current Refining level/XP, success chance,
bounded recent attempts (10), and current-run counters (attempts of the
selected count, per-item inputs and outputs, XP) — reset only on a genuinely new
run.

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
| Stash Mount: The Jag (#284) | 6 Refined Ferrite + 3 Slag | 6 | 300 |
| Stash Mount: Rusk Recovery (#284) | 3 Galvanic Stock + 2 Mounting Brackets | 10 | 500 |
| Stash Mount: Abandoned Processing Yard (#284) | 3 Galvanic Stock + 2 Mounting Brackets | 10 | 500 |
| Stash Mount: Deep Jag (#284) | 2 Galvaferrite + 2 Mounting Brackets + 1 Galvanic Stock | 15 | 750 |
| Curly's Stash Mount: HH B&B (#292) | 6 Refined Ferrite + 3 Slag | 6 | 300 |
| Landing Gear (Crash Site, #322) | 2 Wheel Assemblies + 2 Mounting Brackets + 1 Galvanic Wire Spool | 12 | 600 |
| Propulsion System (Crash Site, #330) | 2 Drive Mounts + 1 Galvaferrite + 2 Mounting Brackets + 1 Galvanic Wire Spool | 16 | 800 |

Curly's mount is The Jag's Tier-1 job, authored as its own entry, done for an
NPC: it is authorized by accepting **Curly Must-Stash**, lives inside HH B&B,
and its completion is a job finished for Curly. It is not a site stash
(`game/content/site-stashes` never names it), holds no player storage, and the
B&B shows its **Build Stash Mount** activity only while the work is authorized
and unfinished — nothing remains once the last section lands.

The Landing Gear (#322) is the Crash Site's second repair, authorized by
accepting **Wheel Be Right Back**. It is the Galvanic-tier step of the ship
ladder — Cargo Hold is Ferrite tier, Landing Gear Galvanic tier, and
Propulsion is reserved for Galvaferrite, which this recipe never uses. Its
materials are finished components, taken by item ID with no provenance, so
fabricated, bought and traded parts are identical and the installing character
needs no Fabrication or Refining level — only the Welding the work itself
trains. It uses the global Welding cadence, the global 50 XP per section and
the ordinary Clean Pass. Its authored `completedStatus` — "Landing gear
restored." — is what the ship-system panel (below) reads when the repair is
complete; it says only what the gear is, and the Propulsion System reports its
own state, so it never has to be corrected when that changes. Completion unlocks
no flight, route or fuel behaviour and adds no ship art or location-state
variant.

The Propulsion System (#330) is the Crash Site's third repair and the capstone
of the ship's physical restoration, authorized by accepting **Thrust Issues**:
the Galvaferrite-tier step after the Ferrite-tier Cargo Hold and the
Galvanic-tier Landing Gear. Like the Landing Gear it consumes finished
components by item ID with no provenance, so fabricated, bought and traded Drive
Mounts are identical and the installing character needs no Fabrication or
Refining level. The two Drive Mounts embed 4 Galvaferrite and 2 Galvanic Wire
Spools, so a self-produced project is 5 Galvaferrite, 3 Wire Spools and 2
Mounting Brackets in total — but the repair consumes only the listed materials,
never that expanded total. It uses the global Welding cadence, the global 50 XP
per section (16 sections, 800 base Welding XP) and the ordinary Clean Pass, with
**no** Mission completion XP, Credits or item: the repair is its own reward.

It is the first Mission-authorized repair that also needs a skill of the hands
doing it. `authorization: { kind: "mission", missionId, requiresMissionWeldingLevel: true }`
adds the personal Welding level the Mission itself requires to the Mission's
acceptance, read by the one `loadRepairAccess` predicate — so the controls,
contribution and Welding commands all agree, and there is no Propulsion-specific
check in a command. The level has exactly one home: the Mission's own
`prerequisiteSkillLevels` (Welding 8) gates the offer, and the repair reads that
same entry rather than restating it, so a Mission can never be accepted and then
never worked. Startup validation rejects the flag on a Mission that requires no
Welding level. A finished repair stays usable whatever the level or Mission state.

The repair's completion is **the** physical fact that the ship is restored.
Nothing duplicates it: there is no persisted `flight_ready` boolean to drift.
The Crash Site's one state variant (`crash_site_ship_restored`, #330) requires
that completion, and the status line reads it together with the Mission's own
completion — `completedStatus` ("Propulsion restored. Report to Wade.") until
Thrust Issues is turned in, then the target's `reportedStatus` ("Propulsion
restored. Ship flight-ready."), through `completedRepairStatus`
(`game/domain/repair-targets`). Both are per character, because both facts are.
Restoring the ship opens **no** flight control by itself. The first flight
(#358, "The Rivet Utility Shuttle and its first flight" below) consumes the
repair completion and the Mission turn-in as facts; it adds no flag to either.

### Ship systems: one presentation, now inside the Ship panel (issue #322)

The Cargo Hold, the Landing Gear and the Propulsion System (#330) are
**visible physical systems of the crashed ship**, and they share one
presentation and state model, `features/ship/ShipSystemPanel.tsx`. Since #358
the three are sections (`ShipSystemSection`) of the **single Ship panel**
(`features/ship/ShipPanel.tsx`) rather than three stacked cards; the standalone
`ShipSystemPanel` shares the same content and state hook. *Visible
damaged system → Mission authorizes the repair → the standard repair
presentation → completed system*. Progression changes whether a system is
actionable, never whether the player can see that the ship has it.

- **Offline** (no authorization, not complete): a compact, noninteractive panel
  — the small `SHIP` eyebrow, the system's name and its authored
  `offlineStatus` (`game/content/repair-targets`). It shows no recipe, no
  material and no progression hint.
- **Repair** (authorized, unfinished): the same panel expands into the standard
  `RepairWorkPanel` (embedded), so every system's materials, Welding meter,
  Clean Pass, skill row and carried-material context look and behave alike.
- **Complete**: the same panel stays, showing the target's authored
  `completedStatus` (or its `reportedStatus` once its Mission is turned in, via
  `completedRepairStatus`), plus any system-specific content passed in as
  children — the Cargo Hold's storage, unchanged.

The state is read from the repair target's own projection (`repairAvailable`,
`complete`) through `deriveShipSystemState`; there is no second flag and the
shell names no Mission and no target. Only the ship's systems use it: the Deep
Jag brace, the Crew Stop and the stash mounts are not parts of the player's ship
and keep the plain repair panel. Moving the Cargo Hold onto the standard repair
presentation retired its bespoke material, Welding and Reward cards and its
separate commit-confirmation step; the install control now names the exact
amounts it takes, as every other repair does. The Propulsion System (#330) was
exactly one more registry entry and one more panel at the Crash Site.

### The Rivet Utility Shuttle and its first flight (issue #358)

Each character owns one Rivet Utility Shuttle. It is not a separate object: it
is the ship already repaired through the repair rows, plus the little that
nothing else could record — where it is berthed, how much fuel is in the tank,
and the one flight that may be under way. That is one row, `character_ships`
(`db/rune-space.ts`): `berth_location_id`, `fuel_units` (CHECK 0–300) and an
all-or-nothing set of flight columns (route, origin, destination, start and
arrival instants). **No row means an untouched ship at the Crash Site with an
empty tank**, so no character is backfilled; the row is created the first time
the tank is filled or the ship launches. The berth moves only when a flight's
landing commits — never when the character walks, so walking to Holo Hollow
Landing neither moves the ship nor completes a Mission.

**Numbers** (`game/config/balance.ts`, `ship`): 300 FU tank, starting at 0. Each
route's cost and duration is balance, its duration in real seconds
(`durationSeconds`) because a flight is scheduled by its recorded absolute arrival
instant, not by counting ticks. The first route, `crash_site_to_holo_hollow_landing`
(`game/content/ship-routes.ts`), costs 10 FU and takes 15 seconds, and is one-way:
nothing ever flies back to the Crash Site. The interplanetary leg (#375, below) is
two more routes. A Full Small Fuel Canister's 50 FU is the item's own `fuelUnits`
(#343).

**Refueling** (`refuelShip`, `server/ship-commands.ts`) has exactly two source
actions: Load from Inventory and Load from Cargo Hold. Each consumes exactly one
Full Small Fuel Canister (never returning an empty shell) and adds 50 FU, or
less when the tank is nearly full, in which case the player must first confirm
the exact gain and waste (`confirmedGainFuelUnits`). The server decides
everything under the character lock: the character must be idle at the ship's
actual berth, propulsion must be restored, the chosen source must hold a
canister, and `expectedFuelUnits` (the tank the player saw) is a stale-view
guard so a retried or racing tap is refused, never loaded twice. `planRefuel`
(`game/domain/ship.ts`) is the one pure rule; the UI restates it only to decide
which button needs a confirmation.

**Launch** (`launchShip`) validates, in one transaction, an authored route that
departs from the ship's actual berth, a character who is at that berth and
idle, the route's required repairs (all three ship systems), a completed Thrust
Issues, an **accepted** Move Along (started by the Thrust Issues report), and at least the route's fuel cost (`planLaunch`). It then
deducts the fuel once, records immutable start and arrival instants on the ship
row, and inserts an `active_actions` row for `ship_flight`. There is no cancel,
abort, refund or second launch, and an operator force-idle fails closed rather
than orphan the flight (`server/play-interrupt.ts`). Move Along gates only the
route that completes it (`requiredAcceptedMissionId`): once it is complete it
gates nothing.

**In flight** the character is in one authoritative state. A default-deny gate
in the shared owned-character boundaries (`server/action-resolution.ts`,
`allowDuringFlight`) refuses every player command — walking, activities,
trading, Inventory and Equipment changes, cargo, Missions — except the Play read
and presentation-only dismissals, so Inventory, Equipment and Missions stay
browseable but nothing mutates. `tests/unit/ship-flight-gate.test.ts` keeps that
opt-out list exact. The client shows a live countdown from the server's recorded
instants (`FlightPanel`), led by the flight cinematic (#359,
`docs/location-scenes.md`), which can be minimized and reopened; a client clock
reaching zero only shows "touchdown pending" and unlocks nothing.

**Landing** is lazy, like every timed action: the next authenticated read or
command resolves an overdue flight through `createShipFlightResolver`
(`server/ship-state.ts`), registered in the Play resolver, with no per-character
timer. It compares the recorded arrival instant to the resolution window, so
the generic offline-work cap cannot delay it — a character returning three
hours after a 15-second flight lands immediately. In one transaction the
resolver moves the character and the ship (and with it the attached Cargo Hold,
whose access is simply "the character is where the ship is berthed" —
`server/cargo-hold.ts`), stamps Move Along complete, clears the flight, and
writes the arrival receipt. It charges nothing at arrival and is idempotent under
simultaneous reads and retries. Inconsistent state throws and rolls everything
back.

**Move Along** is the first Mission completed by a gameplay outcome rather than
a conversation (`docs/missions.md`, "Automatic completion").

**The arrival notice** is `ship_arrival_notices`: a durable, once-per-arrival
presentation receipt written in the landing transaction (unique per character,
route and scheduled arrival instant) and projected until dismissed. Dismissal
(`acknowledgeShipArrival`) is idempotent, presentation only, allowed during a
trade or flight, and changes neither the arrival nor the Mission. It is not a
notification inbox: since flights repeat (#375), a new landing supersedes any
receipt still undismissed (stamping it acknowledged at the new arrival instant),
so the card always describes the latest landing.

**Scenes** read the ship's own berth, not the character's position
(`LocationStateFacts.shipBerthLocationId`, `requires.shipBerth` on a location
state variant): the Crash Site shows the crashed ship, the repaired ship, then
the empty background once the ship has flown; Holo Hollow Landing shows the same
canonical repaired overlay on its empty 4:1 pano only while the ship is berthed
there. No new art.

**The Ship panel** (`features/ship/ShipPanel.tsx`) is the one presence at the
ship's actual berth: the three systems with their repair work, the Cargo Hold's
storage once repaired, and — once Propulsion is restored — a Board Ship control
for fuel and flight. It renders nowhere else.

**The star chart** (#377, `features/ship/StarChart.tsx`, `features/ship/star-chart.ts`)
is how Board Ship's Flight Controls choose a flight to another world. It is
presentation over the projected `ship.routes` only: the berth's planet is the
origin (YOU ARE HERE, never a choice), and the only other worlds drawn are the
planets a projected route lands on, each from its typed presentation
(`game/content/planets`, `PlanetBody`) at the same left-to-right placement as the
flight cinematic's chart. A planet no route from this berth reaches is not drawn,
so planet art never reveals a world. A world whose every route carries a
`launchRefusal` is dimmed and marked Unavailable; it can be selected to read the
server's reason, but LAUNCH stays disabled. The sole launchable route (or a sole
refused one) is preselected; with several, the player chooses. Selection is local
state: LAUNCH sends that route's ID to the unchanged `launchShip`, and a stale
choice the server no longer projects is never sent. A hop on one planet (the first
flight) keeps its single launch card. No discovery state, schema or rule was added.

### The interplanetary leg: Holo Hollow Landing ↔ Stillreach (issue #375)

Two more authored routes in the same registry, one per direction:
`holo_hollow_landing_to_stillreach_landing_station` and
`stillreach_landing_station_to_holo_hollow_landing`. Each costs **120 FU** and
takes **260 seconds** (4 min 20 s), with no other fee, and requires the three ship
repairs and a completed Thrust Issues, the same authorization as the first flight
without its one-time Move Along gate. There is no Rune Fragment, Toll or
conversation gate. Launch, the in-flight gate, lazy landing, the cargo-follows-berth
rule and the arrival receipt are exactly the machinery above; no second transport
engine, table or migration was added (`route_id` and the location columns are free
text, and the berth already moved with each landing).

- **Who and what flies.** One character, their one ship row and its Cargo Hold,
  whose access already follows the berth. Arrival moves the character and the berth
  together; nothing is copied or reset. A route's origin and destination come from
  the authored route and the ship's actual berth, never from the client.
- **Launch.** 119 FU is refused without a write; 120 FU launches and lands with 0. The
  existing character lock serializes concurrent taps, so only one launch charges.
- **Return-fuel warning.** `shipReturnFuelShortfall` (`game/domain/ship.ts`) compares
  the projected tank after landing with the cost of the authored route straight back
  (`shipReturnRoute`) and is projected as `returnFuelWarning` on the route. It is
  **nonblocking**: Launch stays enabled, and nothing refuels or returns the ship for
  free. The first flight has no route back, so it never warns.
- **Landing timing.** A flight lands on the first resolution whose whole-tick window
  reaches the recorded arrival instant. 260 s is not a whole number of 600 ms ticks,
  so a read made in the last tick before arrival does not yet land it and the next
  read (at most 0.6 s later) does; the receipt and berth still carry the exact
  scheduled instant. It never lands early, and an offline return lands at once.
- **No Mission.** Only Move Along authors `autoCompletion` on a flight, keyed on the
  first route's ID, so these landings complete nothing and never replay it. Each real
  landing writes its own receipt (unique on character, route and arrival instant).
- **Planets.** Landing on Stillreach Landing Station puts the character on
  Stillreach's eight-location map (#373), derived from the current location as before.
  Walking away leaves the ship in the ring; walking edges never cross planets.
- **Not From Around Here** completes at the Wise Old Enby on Stillreach (#389). On
  Stillreach its Toll conversation is waived, so Hilltop Workshop is the one
  target whichever planet the Mission was accepted on (`docs/missions.md`).

### Rune Fragment Mining at Harmonic Workings (#383)

Stillreach's Harmonic Workings (2,2) is the dedicated Mining-8 Rune Fragment
source. It is one more `balance.mining.sources` entry (`harmonicMining`, with
its own action ID) read by the one resolver, so the Cutters, Power Cell
boosting, run history, active-action identity and lazy/offline resolution all
apply unchanged. It remains reachable only from The Survey Line.

- **Gate and curve:** personal Mining 8 (refused below it before any action,
  time or roll), a 75-tick (45 s) attempt, and the level-1-anchored curve:
  35% at Mining 1, 46.66% (4,666 bps) at Mining 8, certain at Mining 40.
- **Primary:** a true success yields one or two Rune Fragments, uniformly, and
  130 Mining XP regardless of the count. A charged Loadsteel Cutter adds one
  primary Fragment on a full success only. A primary Fragment earns no
  secondary-find bonus of its own. A miss awards nothing, not even a low yield.
- **One secondary per success, 40 outcomes:** an Intact Runestone (1/8, silent,
  +130 Mining XP once when kept), an Uncut Sapphire (1/20, its usual +30 XP once,
  and a RARE FIND line naming Harmonic Workings only when actually kept), or
  nothing (33/40). The Runestone's find XP is authored as
  `secondaryFindMiningXp: 130` on the canonical intact Runestone item, so the
  shared find projection reads it unchanged.
- **Find XP totals per success:** nothing 130; Intact Runestone 260 (130 base
  plus 130); Uncut Sapphire 160 (130 plus 30); a failure 0. A find that is
  rolled but forfeited for capacity pays no find XP and no announcement. Using
  or breaking apart a Runestone grants no XP.
- **Capacity:** the shared Prioritize primary resources rules apply. Off reserves
  room for the primary plus the largest single find (a 1 kg Runestone); On keeps
  at least one Fragment and forfeits a find that does not fit.

### Stone at the Prospecting Quarry (#379)

Stillreach's first repeatable Mining activity, at the Prospecting Quarry (axial
(1,1)). It is one more `balance.mining.sources` entry (`stone`, action
`stone_mining`) read by the one resolver, so Cutters, Power Cells, boosting, run
history, active-action identity, Prioritize primary resources and lazy/offline
resolution apply unchanged. No new hex, edge, art, NPC or Mission gate: any
character who has physically reached Stillreach and has an eligible Cutter can mine.

- **Numbers.** **33 ticks** (19.8 s; 20.0 s is not a whole number of 0.6 s ticks),
  35% at Mining 1 → 100% at Mining 30 (anchored at level 1), **1 or 2 Stone** from
  one fair coin flip, **45** Mining XP on a success. `lowYield` is `null`: a miss
  awards **no Stone, no find and no XP**. A charged Loadsteel Cutter adds one
  **primary** Stone on a success, never a find.
- **Items.** Stone is **1,000 g, stack 5**, an ordinary tradable, carriable
  resource under *Ores & Gemstones*. The Boulder is **5,000 g, stack 1**,
  `ultra_rare` presentation, owning its own +150 bonus Mining XP. The Boulder has
  no breakdown into Stone, no recipe, no vehicle, no housing use and no NPC price.
  Their art is the owner-approved masters in `assets/item-art/` with runtime
  derivatives from `scripts/prepare-stillreach-slice-c-art.mjs`.
- **Secondary table.** One exclusive 600-outcome roll per success: 150 Rune
  Fragment, 100 Uncut Quartz, 50 Uncut Topaz, 3 Boulder, 297 none (`oneIn` 4, 6, 12
  and 200, the shared `secondaryFindRollSize`). Only the Boulder is announced. At
  Mining 1 the Fragment rate is about 15.9 an hour before inventory and travel, by
  design well below the dedicated rune mine a later slice owns. There is no whole
  Runestone here.
- **Capacity.** The shared preflight applies unchanged. With Prioritize primary
  resources Off, an attempt needs room for 1 Stone plus any one find (the 5 kg
  Boulder included; finds are mutually exclusive, so only one is reserved). With
  it On, one Stone is enough and a find that does not fit after the Stone is
  forfeited with no item, XP, announcement or record.
- **Buyback.** `LocalPlaceDefinition.venuePrices` lets one venue of a merchant add
  price lines the merchant's other venues do not have. The Stillreach terminal
  (`stillreach_fuel_terminal`) adds **Stone → 2 Credits** (the player sells, the
  merchant buys); `merchantAtVenue` composes the catalog for the server command and
  the terminal UI. Toll's counter, Skatboll's catalog and the shared daily canister
  allowances are unchanged, the terminal does not sell Stone, and nothing buys the
  Boulder. The Thrust Issues gate and carried-inventory-only rules are the
  merchant's own.

### Refiner-To-Go: a second Refining venue (issue #381)

`stillreach_refiner_to_go` is a Local Place of Stillreach Landing Station, beside the
terminal, that hosts the **same** Refining console and the **same** authored recipes as the
Abandoned Processing Yard. It authors one fact, `refiningStation:
{ attemptDurationMultiplier: 3 }`; recipes, inputs, outputs, chances, XP, slag rules and
batching are untouched, so there is no second catalog or engine.

- **Rate.** Every attempt takes exactly 3x the recipe's canonical
  `attemptDurationTicks` (fuel 60 → 180 ticks / 108 s). The Yard is 1x. The multiplier is
  applied by `resolveRefining` (`attemptDurationMultiplier`) and never mutates the recipe,
  and XP is not scaled.
- **Authority.** `startRefining` takes an optional `localPlaceId`, revalidated with
  `resolveRefiningStation`: the place must belong to the character's authoritative
  location, be accessible, and be a Refining station; a named place never rescues a
  location that hosts nothing, and a station is never reachable without naming it. The
  venue is persisted on the run as `character_refining_state.run_local_place_id` (NULL =
  Yard, migration `0046`) — a nullable column, because `active_actions` is payload-free and
  nothing else survives refresh, another device or offline resolution. Run resolution, the
  projection's `nextAttemptDurationTicks`/ETA and the console labels all read it through
  `refiningDurationMultiplier`; the client sends no speed factor.
- **Idempotent start.** Starting the recipe already running returns the existing run, so
  reopening the other venue cannot reprice it.
- **Inventory.** Only carried Inventory feeds and receives Refining. The Cargo Hold is not
  an ingredient pool; players move items by the existing Cargo Hold transfer controls.
- **Not a World Location activity.** The landing ring (`availableActionIds: []`) and the
  fuel terminal host no Refining.

### Last Leg Trading's Stillreach terminal (issue #375)

The terminal is its own Local Place, `stillreach_fuel_terminal` ("Last Leg Trading
— Automated Fuel Terminal"), inside Stillreach Landing Station: a second physical
venue of **the same merchant** as Toll's counter (`merchantId: last_leg_trading`
on both places). Prices, the completed-Thrust-Issues gate (both directions) and the
per-character Pacific-day ledger are therefore the existing ones, and because the
ledger keys on the merchant ID, Full and Empty canister purchases at either venue
spend one shared allowance.

- **Place, not location.** The station World Location hosts no merchant, so a
  world-level trade there (no `localPlaceId`) finds none. The terminal sends its
  own `localPlaceId`, which `tradeWithMerchant` honours only when the character's
  authoritative location is its parent; from anywhere else, including Skatboll,
  it is `unknown_place`, and in flight every trade is refused.
- **Navigation.** The place is `access: open`, so anyone at the station can step in
  through the ordinary `?place=` route and see the locked screen; the merchant's
  unlock gates buying and selling. Entering moves nothing and is not travel.
- **Presentation.** At the station, `LocationActivity` shows the Ship panel and the
  directory shows the place; inside, the place's activity is
  `features/trade/LastLegTerminal`, a distinct CSS/SVG vending-terminal front end
  over `useMerchantCounter` (the hook `TradePanel` also uses), and no Ship panel.
  Nobody stands there, so `NpcInteractionPanel` presents no person or Trade row.
- **Sources.** Item Sources lists each venue of a merchant (`merchantVenues`,
  `docs/architecture.md`), so canisters show Toll's counter and the terminal, the
  terminal credited to no one.

The terminal also carries one venue-local line, a 2-Credit Stone buyback (#379;
`venuePrices` on the Local Place), that Toll's counter does not have.

No stock, rotation, second allowance or migration.

### The Crash Site's two scenes (issue #330)

The Crash Site shows the approved **Rivet Utility Shuttle** as one empty
environmental background (`crash-site-empty.webp`) with a state-selected
transparent ship overlay (#351; `docs/location-scenes.md`, "Layered scenes"). The
crashed overlay (`rivet-crashed.webp`, with its local wreckage) is the location's
base scene and the whole of the ship's presentation through the Cargo Hold and
Landing Gear repairs — there are no intermediate ship-art states. The repaired
overlay (`rivet-repaired.webp`) is the single state variant above, so a character
who finishes the Propulsion System sees it the moment the last Welding section
lands and another character at the same site still sees their own wreck. Crash
Site conversation backdrops follow the same repair (`crashSiteExterior` resolves
to `crashSiteExteriorRepaired`), through the existing `repaired` background rule,
and compose the same layers. The original 1536 × 384 baked panoramas (#330) are
retained for the published Update hero.

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
payload. What authorizes an incomplete repair, and where the work physically
happens, are authored content (`game/content/repair-targets`): either an
accepted Mission, or (#284) the character's **personal Welding level**, with an
optional prerequisite repair that must already be complete. A level-gated
target consults no other skill. One predicate (`server/repair-access.ts`) reads
whichever the target authors, for the commands and the projection alike.

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
- Selecting a tile (Carried or stored, one at a time across both) opens one
  full-width details/action area inside that region's grid, directly beneath
  the **selected tile's row**, with the remaining rows after it (#291). The row
  boundary is the column count the grid is laying out now (three on a phone,
  four from `sm`), measured rather than assumed, and the area sits in the
  grid's own DOM order so reading and tab order match what is drawn. A yellow
  border and a connector under the selected column tie it to its tile. The
  preview is artwork beside the full item name and its quantity or charge — never
  a `VisualTile` squeezed into a thumbnail — so a long name wraps instead of
  clipping. The placement, measured column count and connector are the shared
  `features/shared/RowDetailsGrid.tsx`, which Inventory also uses (#311) for its
  own richer details at its own two-column phone / four-column grid. Selecting the same tile or Close dismisses it; the shared
  selectable-details reveal, reduced-motion handling and focus restoration are
  unchanged. Cargo Hold and every site stash share this surface.

### Practice Welding: the repeatable training loop (issues #190 and #229)

Wade's Workbench at Rusk Recovery is genuine Welding that repeats. It shares the
skill, the **5-tick / 3 second** section cadence, and Clean Pass with every
repair; what differs is that nothing is being fixed, so it pays a reduced share
of the Welding XP and can be done as often as the player likes, a selected
number of welds at a time.

| Fact | Value | Home |
| --- | --- | --- |
| Input per weld | 2 Scrap Metal, consumed when the weld begins | `balance.practiceWelding` |
| Sections per weld | 10 | `balance.practiceWelding` |
| XP per section | authored share of the global Welding XP (20% → 10, so 100 per weld) | `practiceSectionXp()` |
| Output per weld | up to 2 Slag, at completion time | `balance.practiceWelding` |
| Scrap Metal | `stackLimit: 3` (#230); consuming it frees a slot only when a stack empties | `balance.items.scrapMetal` |
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
- **A run of complete welds, or Max (#229).** Start takes a number of welds or
  Max (see "Bounded runs"); a paid partial weld being resumed is the run's
  first either way. Each completed weld begins the next one, consuming its two
  Scrap at that instant, through the ordinary lazy resolution and the standard
  one-hour offline cap. A run stops itself for one of these authored reasons,
  checked in this order before a next weld would begin:
  `finished_current_weld`, when the player has asked the run to end after the
  weld already on the bench — see "Stop After Current Weld" below;
  `run_completed`, when every weld of a number has completed (a Max run never
  reports it); and `out_of_scrap`, when fewer than two Scrap remain (adding
  Scrap later never auto-restarts it) — which is how a Max run normally ends.
  `run_safety_limit` is only the Max run's internal guard. Every other way a
  run ends — the player's ordinary Stop, Travel — is an interruption, not a
  resolution, and is recorded as neither.
- **The affordable count** is `practiceAffordableWelds`: the paid partial weld
  (if any) plus one weld per two carried Scrap. It is the most a number may ask
  for. Slag can never block a weld, and Scrap stacking to three (#230) changes
  which slots a weld frees for its Slag, not how many welds the Scrap pays for.
- **Stop and Resume** preserve the real partial weld: the completed sections,
  the two Scrap already spent, and the rolled Clean Pass positions. Resuming
  costs nothing and works with no Scrap at all. Stop never refunds, never
  produces Slag early, and never rerolls.
- **Travel** stops the bench through the same Practice interruption helper the
  player's own Stop uses (`interruptPracticeWelding`), and Practice is on the
  explicit travel-replaceable action list. There is no remote Welding.
- **Slag at completion time** honours the character-wide Auto-discard Slag
  setting shared with Refining (#256), shown as the latched
  `Auto-discard Slag: On/Off` toggle (#239): Off (keep
  Slag) adds as much as ordinary capacity allows and discards only the
  overflow; On discards both. Output capacity can never block or fail
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

Because a Practice run rolls straight from one selected weld into the next,
consuming Scrap as each begins, the player needs a way to end it early and
leave the bench clear on purpose: ordinary Stop preserves a
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

## Site stashes (issue #284)

Four authored activity sites let a character permanently build one **stash
mount** and then install **any ordinary owned container** into it, giving that
site location-bound storage. The storage surface is the one #282 extracted
(`features/storage/StorageTransferSurface`); nothing about a stash duplicates
the Cargo Hold's panel, tile grid or transfer controls, and the ship Cargo Hold
keeps its own behavior and repair UI.

### The mount: an ordinary repair target

A mount is not a new table. It is a repair target (above) per site, so its
materials, Welding sections, normal **50 Welding XP per section** (before
normal Clean Pass effects), durable per-character state and 5-tick / 3-second
cadence are exactly the existing Welding system's. A mount is "built" exactly
when its repair target is complete (`game/content/site-stashes` names the
target per location); one mount per character per site, never rebuilt, with no
bonus completion XP.

| Site | Welding gate | Materials | Sections | Time | Base XP |
| --- | --- | --- | ---: | ---: | ---: |
| The Jag | 1 | 6 Refined Ferrite + 3 Slag | 6 | 18 s | 300 |
| Rusk Recovery | 5 | 3 Galvanic Stock + 2 Mounting Brackets | 10 | 30 s | 500 |
| Abandoned Processing Yard | 5 | 3 Galvanic Stock + 2 Mounting Brackets | 10 | 30 s | 500 |
| Deep Jag | 8, and its cave-in repair complete | 2 Galvaferrite + 2 Mounting Brackets + 1 Galvanic Stock | 15 | 45 s | 750 |

Only the **personal Welding level** gates building; Mining, Refining and
Fabrication levels are never prerequisites, and every material may be traded
for. The character must be at the site. The times are derived from the existing
section cadence, not separate timers. A mount's Welding action is deliberately
**not** in any location's `availableActionIds`, which would list it to
characters who have not earned it.

### Progressive presentation

The server projects `siteStash` only for the character's current site and only
when the mount is already built or the gate is met. Before that nothing about a
stash exists to render: no Build Stash Mount panel, locked teaser or disabled
control. Once qualified the standard `RepairWorkPanel` builds the mount; then a
visible choice of container to install; then the shared storage surface, with
**Swap Container** and **Remove Container** behind a quiet management
disclosure.

A stash is secondary to the site's own activity, so it renders as ONE panel
(`features/site-stash/SiteStashPanel`) **below** that activity, collapsed by
default. The compact bar is that panel's header, not a separate control above a
second card: one frame, one title, one Show/Hide. It states the stage and the
progress that matters (`summarizeSiteStash`): required material counts and welds
while building, then the installed container and its used/total slots. Under it
is the one thing the stage needs:

- **Building:** `RepairWorkPanel` with its optional `embedded` display prop, so
  the same controls, meters and rules render without a second frame or title.
- **Built, no container:** **Choose a container**. The server's
  `carriedContainers` (carried and unequipped; nothing equipped is ever offered)
  are real item cards, each the item's approved presentation with its slot count.
  A card only selects; **Install selected container** is the command. A sole
  candidate starts selected. With none, one explanation in place. Installing
  swaps the choice for storage in the same open panel, with no second tap.
- **Installed:** the shared `StorageTransferSurface` immediately (carried and
  stash tabs on a phone, two regions on desktop). There is no second heading,
  occupancy line or Open/Close button; the header already says the container and
  its slots. Collapsing and reopening returns straight to storage.
- **Container management** (Swap, Remove): a disclosure at the foot of the panel.
  Opened, it offers the swap candidates the server accepts as cards plus an
  explicit **Swap to selected container**, or the reason none is valid, and
  Remove with the reason it is blocked. Every rule is the projection's.

Confirmations are transient (a polite status that clears itself, since the
header already proves the result); refusals and failures stay until the next
action. Nothing is confirmed before the server says so.

While that mount's own Welding is running the detail is held open and the bar
cannot be collapsed, so Stop and the time-sensitive Clean Pass are never hidden;
it stays open after Stop. When the mount completes, the wrapper (not the
unmounting construction panel) announces it, folds back to the bar, and the bar
then asks for a container.

The bar is two fixed rows: the title (**Build Stash Mount**, later **Site
Stash**) and its Show/Hide control share the first, and the summary takes the
whole second, so a long recipe can never decide where the control sits. When the
player themself opens the panel, installs a container, or opens Container
management, the start of what they asked for is scrolled to the top of the
viewport once rendered (Mining alone can fill a phone screen, so it would
otherwise open below the fold). Page load, background refreshes, Welding opening
the detail on its own, collapsing, and unrelated actions never scroll. Reduced
motion scrolls without animation.

### Activity ownership of the running action

`state.activeAction` is one global value, and a site's own activity and its
stash's Welding are both live at once at four sites. Every activity surface
therefore treats it as its own only when the `actionId` is one of its own: Mining
by the current `miningSource.actionId`, Refining by `refiningActionIds()`, a
Welding mount, the Cargo Hold and the Crew Stop by their repair target's action,
and the Workbench, Work Orders, Tinkering and Fabrication by the server
projection's own `active` flags and `workpiece`, each of which exists only when
the running action's ID is that activity's. While another activity's action is running, an activity
shows no attempt meter, timing label or Stop control, its Start control is
disabled, and its durable counts (a mount's completed welds, a run's totals) move
only with the work that earns them.

### Container authority and lifecycle

Installed capacity is exactly the container item's authored equipped slot count
(MYKEA 8, Freight Harness 6, Scrap Box 3), read from the equipment-definition
boundary, never the client; stored mass is unlimited. Persistence is
`site_stash_containers` (one row per character and site; the instance keeps its
`item_instances` row and mutable state), `site_stash_stacks` and
`site_stash_item_instances`. Contents reference the installed container by
composite foreign key, so a container row cannot be deleted while anything is
stored.

- **Install** needs a built mount, no container already there, and a personally
  owned, **unequipped, physically carried** container instance. An installed
  container leaves carried/equipped availability.
- **Remove** needs a completely empty stash; the returned container must fit
  carried Inventory by slots and mass.
- **Swap** replaces the container with a **different item type** without
  emptying the stash, if its authored capacity holds every occupied slot (equal
  capacity is fine, heavy to light included). The same type is refused even for
  a different instance. The returned old container is checked against carried
  room **after** consuming the replacement. It is one row update: stored
  contents never move, and the mount is never disassembled.
- **Deposit and withdraw** keep stack and unique-item semantics and carried
  slot/mass checks. Every command re-proves, under the character lock, that the
  character is at that site with no activity running, the mount is built, a
  container is installed, and slots remain. They never call Cargo Hold handlers,
  whose access and fixed 32-slot model are ship-specific.

An installed container, and anything stored in a stash, is owned but **not
carried**: `loadOwnedItemInstances` subtracts both, so carried slots and mass,
Tinkering, Mission turn-in, trade eligibility and equipment all exclude them,
and a unique item can only be in one place. Trade offers, Cargo Hold deposit and
the operator's delete-item tool refuse or handle it explicitly.

### Non-goals

No Circuits, remote telemetry, ship control center or remote inventory reading;
no Deposit All / Withdraw All; no new container items, art or trading changes.

## Fabrication and Tinkering (issue #232)

Fabrication turns processed stock into discrete items. It is a standard skill on
the shared level curve (`skillLevelCurves` in `game/config/balance.ts`), starts
at level 1, appears on every progression surface through the canonical skill
projection, and carries its approved Shop Olive accent (`#7FA347`) there like
every other skill. Tier 1 shipped with #232; Fabrication 5 and 8 follow (#233).

### Rusk Recovery's two work areas

Rusk Recovery stays one World Location — no Local Place, no separate scene. Its
place, art and people stay shared at the top of the Location surface; beneath
them, once Tansy has opened the station, two prominent work-area cards select
which surface is expanded: **Welding Workshop** (Practice Welding, the Work
Orders terminal, and the one shared bench) and **Fabrication Station**
(Fabricate, and Tinker once it is unlocked). Only the selected area's surface
renders. Work actually running decides the area shown, and a Mission turning to
the station brings it forward. Before Return the Favor is accepted the yard
renders exactly as it did before #232. This is the yard's own composition
(`features/location-scene/RuskRecoveryWorkAreas.tsx`), not a work-area
framework.

Accepting Return the Favor opens Fabricate; completing it — Tansy's
demonstration — opens Tinker (`RUSK_RECOVERY_CONTENT`). Both are derived from
the Mission record, never a flag.

The station answers "what can I do now?" (human-preview reconciliation of
#232), through the pure rules in `features/fabrication/station-lists.ts`:

- **Fabricate** lists level-unlocked recipes whose materials are carried for one
  batch, plus any recipe a Mission is guiding, shown with what it is missing, so
  guidance never points at a hidden recipe. There are no list filters.
- **Tinker** lists level-unlocked targets with a complete carried, unequipped
  batch; a carried Cutter held back only by last-Cutter safety stays, showing
  the safety reason.
- **Recipes** is the read-only catalog of every recipe the character's level
  unlocks, carried materials or not; nothing above the character's level. The
  public Wiki remains the whole skill's reference.

Newly observed outcomes show as one inline **result beat** — item made or
dismantled, Scrap, XP, an Override success's multiplier, or a distinct bust.
It is presentation of the authoritative run counters
(`features/fabrication/station-results.ts`): whatever resolved before the client
looked, one or a whole offline Max run, arrives aggregated as one beat. The last
observation is remembered per character on the device, so a first visit only
records a baseline.

### Tier-1 recipes

| Recipe | Inputs → output | Duration | Base XP |
| --- | --- | --- | --- |
| Mounting Bracket | 2 Refined Ferrite → 1 Mounting Bracket (300 g, stack 5) | 12 ticks / 7.2 s | 25 |
| Direct Scrap | 2 Refined Ferrite → 1 Scrap Metal | 10 ticks / 6 s | 10 |
| Scrap Box | 1 Mounting Bracket + 2 Scrap Metal + 3 Refined Ferrite → 1 Scrap Box | 36 ticks / 21.6 s | 81 |
| Salvage Cutter | 5 Refined Ferrite + 1 Power Cell → 1 Salvage Cutter | 20 ticks / 12 s | 65 |

All are Fabrication 1. Each recipe is its own action ID, so the durable action
row is the recipe on the machine. The Scrap Box is a unique 5 kg container
attachment that adds +3 Inventory slots in either of the existing two container
slots — there is no third. A fabricated Salvage Cutter is another ordinary
Cutter instance at the Cutter's ordinary uncharged state; the recipe's Power
Cell is a construction component, not stored charge. Direct Scrap is a utility
recipe and not a Tinkering target.

### Fabrication 5 and 8 recipes (issue #233)

| Recipe | Level | Inputs → output | Duration | Base XP |
| --- | ---: | --- | --- | ---: |
| Direct Galvanic Scrap | 5 | 1 Galvanic Stock → 2 Scrap Metal | 14 ticks / 8.4 s | 15 |
| Galvanic Wire Spool | 5 | 1 Galvanic Stock → 1 Galvanic Wire Spool (1,000 g, stack 3) | 24 ticks / 14.4 s | 45 |
| Power Cells | 5 | 1 Galvanic Stock → 2 Power Cells | 30 ticks / 18 s | 75 |
| Loadsteel Cutter | 5 | 2 Galvaferrite + 1 Galvanic Wire Spool + 1 Power Cell → 1 Loadsteel Cutter (8,000 g, unique) | 45 ticks / 27 s | 180 |
| Wheel Assembly | 5 | 3 Refined Ferrite + 1 Galvanic Stock + 1 Mounting Bracket → 1 Wheel Assembly (1,550 g, stack 2) | 36 ticks / 21.6 s | 100 |
| Drive Mount | 8 | 2 Galvaferrite + 1 Galvanic Wire Spool → 1 Drive Mount (2,900 g, stack 2) | 48 ticks / 28.8 s | 200 |
| Freight Harness | 8 | 4 Galvaferrite + 2 Mounting Brackets → 1 Freight Harness (9,000 g, unique) | 60 ticks / 36 s | 270 |
| Empty Small Fuel Canister (#343) | 8 | 1 Galvanic Stock → 1 Empty Small Fuel Canister (800 g, stack 5) | 30 ticks / 18 s | 75 |

Reaching the level is the whole gate: no Mission, NPC permission or personal
Refining level is involved, so Galvanic Stock or Galvaferrite acquired from
anywhere is valid input. Accepting A Cut Above unlocks nothing. The station
supplies mundane winding cores, insulation, casings and charging hardware, so
none of those is an inventory item.

- **Power Cells** are one authored two-output batch of ordinary, usable Power
  Cells — there is no uncharged Cell and no charging step. A run counts batches,
  and the recipe tile always shows the one batch (x2): four batches still show
  x2 while the run summary totals eight Cells. Bix's prices and daily limit are
  unchanged (#230).
- **Direct Galvanic Scrap** is the Galvanic-tier utility counterpart of Direct
  Scrap: material access, not training, and not a Tinkering target.
- **The Loadsteel Cutter** is a separate second Mining tool, not an upgrade or
  transformation of the Salvage Cutter. A new one comes off the machine at 0/10:
  its Power Cell commissions the tool and is not stored charge. See the Mining
  slice for its behaviour.
- **The Wheel Assembly** (#322) is an ordinary tradable stack: its 1,550 g is
  exactly its inputs (3 x 150 g Refined Ferrite + 800 g Galvanic Stock + 300 g
  Mounting Bracket), and a stack of two is the Landing Gear's whole wheel
  requirement. It is open at Fabrication 5 by level alone — accepting Wheel Be
  Right Back unlocks nothing — and it is a normal Tinkering target.
- **The Drive Mount** (#330) is an ordinary tradable stack: its 2,900 g is
  exactly its inputs (2 x 950 g Galvaferrite + a 1,000 g Wire Spool), and a
  stack of two is the Propulsion System's whole mount requirement. It is open at
  Fabrication 8 by level alone — accepting Thrust Issues unlocks nothing — and
  it is a normal Tinkering target. It has no merchant stock, buyback or price:
  buying its materials is valid, but nothing sells a Drive Mount.
- **The Freight Harness** is an advanced container attachment: +6 Inventory
  slots in either of the two existing container slots, carried at its full
  9 kg — not a carry-capacity upgrade.

### Fuel manufacturing (issue #343)

Two recipes on the existing engines turn Skatboll's Oil Shale into fuel the
player can carry. Neither is a new system: each is one authored entry, and there
is no price or freight pad here; the ship's tank, refueling and flight arrived
in #358.

- **Empty Small Fuel Canister** — Fabrication 8 at the existing Rusk Recovery
  station: 1 Galvanic Stock → 1 canister, 30 ticks, 75 base XP (deliberately the
  Power Cell recipe's duration and XP). Ordinary Fabrication never fails; Manual
  Override, batches and Max behave exactly as for every recipe. It is not a
  Tinkering target. The empty shell is 800 g — exactly the Stock it is made from
  — and stacks to 5.
- **Full Small Fuel Canister** — Refining 8 at the Abandoned Processing Yard's
  one console: 10 Oil Shale + 1 Empty canister → 1 Full canister, 60 ticks
  (36 s) whether it succeeds or fails, 100 XP on success and 20 on failure. The
  chance is the Galvanic Stock / Galvaferrite curve unchanged — 3,500 bps at
  Refining 1 to a guaranteed 10,000 at 30, so the level-8 unlock sits at 5,068
  bps (50.68%) rather than restarting the climb. The Full canister is 6,000 g,
  stacks to 2 and carries `fuelUnits: 50` on its item definition, which the
  Rivet's tank loads from (#358).

A failure is a `fixed_outputs` branch of two *returned inputs*: exactly 5 of the
10 Oil Shale and the same shell come back, the other 5 shale are lost, and
nothing else is produced — no Slag and no liquid or fuel item. Mass accounting:
10 × 600 g + 800 g = 6,800 g in; a success leaves a 6,000 g canister (800 g of
process waste is not an item), a failure leaves 3,000 g of shale and the 800 g
shell (3,000 g lost).

What the existing resolver already guarantees, and the #343 tests pin:

- **Inputs are removed first.** Every outcome is then judged against the
  inventory after removal, so a success (one canister) and a failure (5 shale +
  1 shell) can never need more room than the ten shale and the shell just freed.
  A completely full inventory at the mass ceiling can therefore run an attempt,
  and a missing shell or shale refuses it before any roll, XP or consumption.
- **Retries are one window.** A returned shell and shale are real stack state
  inside the settlement window, so a Max or numbered run spends them again in the
  next attempt exactly as lazy/offline resolution would: gross use can exceed
  what was ever carried at once, but net inventory is conserved. A failed attempt
  counts toward a numbered run like a success.
- **Carried inventory only.** Nothing is drawn from the Cargo Hold, a stash or a
  trade offer; items are ordinary stackable, tradable and stashable stacks with
  no recipe-specific transfer rule and no merchant price.
- **No client authority.** The selected recipe is the active action, the roll is
  the server's, and level, location and quantity are re-checked in the command.

The item art is the owner-approved pair of masters
(`assets/item-art/{empty,full}-small-fuel-canister.png`): the Empty is a silver
cylinder with a brass valve and no red hardware, the Full the same cylinder with
a red cap and a red side locking bar. The production derivatives follow the
Wheel Assembly convention (see `assets/item-art/README.md`).

### The workpiece is binding

Starting a workpiece commits it. Its complete input set is **reserved**: the
units stay in the real `inventory_stacks` rows, still counting for mass and
slots, but nothing may make them unavailable, and nothing may take away the room
its output was guaranteed. Most carried-item commands already refuse while any
action runs; the ones that deliberately do not — Drop, equipment changes, Power
Cell loading, and the operator's carried-item tools — end by asking
`assertActiveWorkpieceResolvable` whether the workpiece could still resolve
exactly as committed, and roll the whole command back when it could not. Spare
units the workpiece does not need can still be dropped.

Only the workpiece on the machine is reserved. Before each later workpiece
begins, the next one is checked against the inventory the last one actually
left.

Resolution is one transaction. **Success** revalidates the level, the reserved
inputs and the output's room — judged against the hypothetical inventory *after*
the inputs leave, so an output may use the slot its own inputs free — then
consumes the whole input set, creates the whole output and grants the XP
together. A **Manual Override bust** consumes the whole input set, creates
nothing, and grants 0 XP. Nothing ever persists half a recipe.

There is no cancel. A started workpiece cannot be stopped mid-cycle, travelled
away from (Travel refuses it — it is deliberately not travel-replaceable), or
replaced by another activity; Stop on a run means **Finish Current**: the
workpiece on the machine resolves normally and no next one begins or reserves
anything. Disconnects and reloads change nothing: resolution is the ordinary
lazy/offline resolution with its one-hour cap. An operator's Stop clears the
workpiece without consuming its inputs, which were never consumed in the first
place, and records `manually_stopped`.

Persistence: the recipe is the active action's ID, the workpiece's start is the
action's cursor, and the reserved inputs are that recipe's input set in the real
rows — nothing about carried items is cloned. `character_fabrication_state`
(migration 0030) holds only what those cannot: the run's selection and totals,
the Finish Current intent, the station's Manual Override toggle, and the current
workpiece's machine state.

### Runs: a number, or Max

Fabrication uses #229's shared selector. A number is a bounded count of recipe
batches (busts included), capped at Start by what the inputs carried right now
pay for, and refused — never shortened — when it no longer fits. **Max** is a
run-until-blocked mode: after every resolved workpiece the next one begins only
if it can, and the run stops with the ordinary reason (`insufficient_inputs`,
`inventory_slots_full`, `carried_mass_capacity_reached`). Before Start a number
shows exact whole-run totals at the safe 1.00× baseline — inputs, outputs, base
time, base XP — and Max shows one batch's facts.

### Manual Override

Optional per workpiece, never a third mode: the station's toggle (persistent per
character) decides whether each new workpiece starts as an Override workpiece.
Off is an automatic 1.00× Lock In. On, a workpiece starts at 1.00× with a Load
rolled uniformly from 2–9 and a visible Trend (50/50 at 2–9, forced HIGHER at 1
and LOWER at 10). A push names a Feed from 1–10; the next Load is rolled then —
uniformly from L+1–10 for HIGHER or 1–L−1 for LOWER — and a Feed within ±2 of it
(clipped to 1–10) compounds the multiplier ×1.20, exactly on it ×1.30; a miss
busts the workpiece. The fifth successful push locks in by itself. XP is the
recipe's base XP compounded by every push, rounded down.

Lock In may happen at any time: before timer 0 the multiplier commits and the
timer runs on; at or after it the workpiece resolves at once. Switching Override
off is Lock In at what was earned. A workpiece whose timer runs out while its
machine is unlocked **holds at 0 indefinitely** — producing nothing, starting
nothing, and still blocking Travel and other activities — until the player
decides. There is no reaction-time pressure.

Every machine state is persisted, so a reload or a retried request observes the
same Load; nothing about the next Load exists before the push that rolls it.
Push and Lock In carry the workpiece number and push count the player saw, so a
duplicated request can neither push twice nor land on a later workpiece. A CI-
only deterministic source (`defaultOverrideRandom`) makes browser journeys
reproducible.

### Tinkering

Tinkering dismantles one complete authored Fabrication output batch at the
station for Fabrication XP and Scrap Metal. The Tier-1 targets are the Mounting
Bracket, Scrap Box and Salvage Cutter; eligibility follows the item's recipe
level. Every number is derived from the recipe through universal rules — the
recipe's base XP, twice its duration, and one Scrap per two immediate input
units rounded up: Salvage Cutter 65 XP / 24 s / 3 Scrap, Scrap Box 81 XP /
43.2 s / 3 Scrap, Mounting Bracket 25 XP / 14.4 s / 1 Scrap. Scrap only, never
original ingredients, and no Override multiplier travels with an item.

The Fabrication 5 and 8 targets (#233) follow from the same rules with no item
exception: Galvanic Wire Spool 45 XP / 28.8 s / 1 Scrap and Power Cells 75 XP /
36 s / 1 Scrap (a complete batch of **two** Cells — one Cell alone is never
Tinkered) and Loadsteel Cutter 180 XP / 54 s / 2 Scrap, all at Fabrication 5;
Wheel Assembly (#322) 100 XP / 43.2 s / 3 Scrap at Fabrication 5 (five input
units, rounded up), Drive Mount (#330) 200 XP / 57.6 s / 2 Scrap and Freight
Harness 270 XP / 72 s / 3 Scrap at Fabrication 8. Neither Direct Scrap recipe is
a target.

It follows Practice Welding's cycle model: a cycle commits — destroys — its batch
the instant it begins, so a refresh can neither duplicate nor dodge the
destruction; ordinary Stop (and Travel) keeps the committed cycle and its worked
ticks, Resume continues it without committing another, and Finish Current
completes it and commits no next. A number is capped by the complete batches the
eligible carried items form; Max runs until the next batch cannot begin.
Equipped and stored items are never selectable, and a unique batch spends the
least value first — an uncharged instance before a charged one, then the newest.

**Auto-discard Scrap** is a persistent per-character preference, default off.
Off, a cycle begins only when its Scrap can be kept; on, the batch is still
destroyed and XP still paid, but the Scrap is discarded. If room was lost
mid-cycle, what fits is kept and the rest is reported as discarded.

**Last-Cutter safety (first-alpha provisional):** a Cutter batch that would
leave the character with zero usable Mining Cutters across equipped gear,
carried Inventory and the Cargo Hold is refused, and a Cutter that would be the
last never counts as a batch the selector may offer. Since #233 either Mining
tool is a Cutter, and "usable" is the tool's own Mining requirement: a Loadsteel
Cutter keeps a Mining 5 character able to mine, but not a Mining 4 one — so
below Mining 5 the Salvage Cutter beside it is still the last usable Cutter,
and the Loadsteel Cutter itself may be taken apart. Player-trade settlement
(#267) applies the same count at commit: a trade may not take either character
from a usable Cutter to none, while a Cutter-for-Cutter swap that leaves each
with one is fine (`docs/architecture.md`, "Player trade offers, settlement, and
audit").

State lives in `character_tinkering_state` (migration 0030): the preference, the
committed cycle's target and worked ticks, the Finish Current intent, and the
run.

## Runeworking at the Resonance Rig (issue #391)

Runeworking (`RW`) is the fifth persistent skill: an ordinary skill that starts
at Level 1 on the standard curve (Level 2 at 500 XP), shown wherever skills
are, with its own accent, **Electric Rose** (`--rs-skill-runeworking`,
`docs/design-system.md`). It is practised at one place: the Wise Old Enby's
prebuilt **Resonance Rig** at Hilltop Workshop on Stillreach — the existing
World Location, with no new hex or Local Place. The Enby's card stays above the
Rig; talking is never needed to use it.

**Access.** The Rig opens when *Not From Around Here* is complete, read from
that Mission's completion stamp (`HILLTOP_WORKSHOP_CONTENT` in
`game/content/hilltop-workshop.ts`) whether or not *First Runeworking Lesson* is
ever accepted. Hilltop Workshop lists the recipe action statically; the server
refuses Start elsewhere, before the mystery is complete, or while another
activity runs.

**The one recipe.** Authored in `balance.runeworking.recipes`:

| Recipe | Level | Input | Output | Time | XP |
| --- | ---: | --- | --- | --- | ---: |
| Beginner Echo Seeker | RW 1 | 1 Rune Fragment | 1 Beginner Echo Seeker | 34 ticks (20.4 s) | 25 |

Every cycle succeeds: no chance, failure, Manual Override, minigame, slag or
byproduct. The Seeker is an ordinary *Components & Supplies* stack (200 g,
stack limit 5) with the approved description and art
(`assets/item-art/beginner-echo-seeker.png` → `public/item-art/beginner-echo-seeker.webp`).
Its Use, in ordinary Item Details, takes a Resonance Echo reading (below).

**Runs.** The Rig reuses the shared bounded-run contract ("Bounded runs"): a
number counts completed cycles; Max keeps going until the next cycle cannot
legally start and never states a total. Each cycle is bound when it begins, its
one Fragment reserved in place (dropping it, or an operator removing it, is
refused by the shared reservation guard; spare Fragments are not reserved).
When the cycle completes it consumes the Fragment, adds the Seeker (topping up
a partial stack before taking a slot), awards 25 RW XP and credits any accepted
Mission counting Seeker attunements — all in one transaction under the
character lock and the action cursor. The next cycle is decided from the
inventory that cycle actually left: the Fragment's slot frees only when it was
the last, the Seeker weighs what the Fragment did, so a run ends with
`insufficient_inputs` or `inventory_slots_full`, never with a fake cycle.
**Finish Current** is the only stop: the cycle on the Rig completes and pays,
and no other begins; there is no cancel. A cycle is binding: Travel is refused
while it runs, not replaced. An operator Stop clears it without consuming
anything. Offline and reconnect resolution is the ordinary Play resolver.

**Surfaces.** `features/runeworking/` presents the Rig with the station
scaffolding Fabrication uses: **Attune** (recipe tiles, the 1/−/+/Max selector,
the ingredient's Sources, the running cycle, This Run) and **Recipes** (a
read-only catalog of learned recipes, shown even without Fragments).

**Authority.** `game/domain/runeworking.ts` (pure capacity, cycle checks and
resolution), `server/runeworking.ts` (snapshot, resolver, persistence),
`server/runeworking-commands.ts` (Start, Finish Current), run state in
`character_runeworking_state` (migration `0047_runeworking_state`). See
`docs/architecture.md`, "Runeworking".

**The lesson.** *First Runeworking Lesson* teaches it — three Seekers attuned
after acceptance, then the Enby's turn-in for 150 RW XP (`docs/missions.md`).
Later attunements are always allowed and pay their ordinary XP.

## Beginner Resonance Echo hunts (issue #393)

A **Beginner Echo Seeker** is used from its ordinary Inventory Item Details —
no Inspect control, hunt screen or map marker. Any legitimately held Seeker
works, crafted, traded or given.

**The reading.** Use starts one stationary timed action, 8 ticks (4.8 s), under
the ordinary active-action boundary: refused while any other action runs,
never travel-replaceable, and resolved lazily — live, on refresh, or in the
ordinary offline catch-up — exactly once, by its own cursor. It needs one
carried Seeker at Start and reserves it until it resolves (the shared
reservation guard refuses a drop or equipment change that would take it). A
resolved reading consumes **exactly one** Seeker, found or not. An operator
force-idle deletes the action and changes nothing else.

**Which planet.** A reading searches the planet the character stands on.
Each character has at most one active Beginner hunt per planet
(`character_echo_hunts`, keyed by character, planet and tier). The first
reading on a planet with no active hunt chooses a hidden target uniformly from
that planet's **fixed** pool (`game/content/echo-hunts.ts`) and resolves against
it at once, so the first reading may succeed where the player stands. Pools
never grow with progression: **Skatboll** — its ten ordinary World Locations,
Deep Jag permanently excluded; **Stillreach** — all eight. The target never
leaves the server; travel, flights, logins, trades and acquiring Seekers never
touch a hunt, and each planet's hunt and clue are independent.

**A wrong reading** pays nothing and records the hunt's last clue: the source
hex, both axis directions from it — `east`/`west`/`aligned` on the map's x axis
and `north`/`south`/`aligned` on its y axis, using the flat-top layout's own
screen axes (`echoScreenAxes`: x ∝ q, y ∝ 2r + q) — and the time. A new
reading replaces that planet's clue. Item Details show the planet being
searched, that planet's last reading (or "No reading on this planet yet"),
and a read-only check of the current hex against it: **ruled out** naming the
contradicting axis, or **not ruled out** — never "the Echo is here". Use stays
available on a ruled-out hex.

**A discovery** deletes the planet's hunt row (ending the hunt and its clue
together; the next reading there starts a new hunt), pays a fixed **50
Runeworking XP**, credits any accepted Mission counting `echo_hunt`
completions, and rolls **exactly one** item from the current planet's table.
The item's fit is planned against the inventory left after the Seeker is
consumed (partial stacks, a freed slot, freed mass). If it does not fit by
slots or mass it is lost — named in the result as having slipped back into
RuneSpace — with no reroll, mail or ground drop; the XP and Mission credit
stand. Use is never blocked because the inventory looks full.

**Interim tables (Slice I).** Integer weights out of 1,000
(`balance.echoHunts.beginner.rewardTables`). The approved tables reserve 0.2%
for a Legendary that is not shipped; until it is, that 0.2 point is on Rune
Fragment.

| Item | Skatboll | Stillreach |
| --- | ---: | ---: |
| Rune Fragment | 30.2% | 30.2% |
| Uncut Quartz | 24% | 26% |
| Uncut Topaz | 16% | 20% |
| Uncut Sapphire | 10% | 10% |
| Refined Ferrite | 12% | — |
| Galvanic Stock | 5% | — |
| Empty Small Fuel Canister | — | 10% |
| Intact Runestone | 2.8% | 3.8% |

**The result is durable.** Each resolved reading writes one
`echo_reading_notices` row keyed by its own completion instant, shown as a
dismissible receipt at the top of Play until dismissed (starting a new reading
dismisses it too). Item Sources list "Resonance Echo" for every table item once
the Resonance Rig is the character's.

**Authority.** `game/domain/echo-hunts.ts`, `server/echo-hunts.ts`,
`server/echo-hunt-commands.ts`; migration `0048_echo_hunts`. The Mission that
teaches it is *First Resonance Echo* (`docs/missions.md`).

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

### Equipment definitions (issue #233)

Every piece of equipment is described by one authored **equipment definition**
on its item entry in `game/config/balance.ts`, resolved through
`getEquipmentDefinition` (with `getMiningToolDefinition` and
`getItemMaximumCharge` as its narrow readers). It is deliberately two closed
kinds, not an item-effect language:

| Kind | Fits | Authors | Items |
| --- | --- | --- | --- |
| `mining_tool` | the one `mining_tool` gear slot | Mining level to equip and use, maximum charge, base-duration multiplier, charged effect (`speed` or `extra_yield`) | Salvage Cutter, Loadsteel Cutter |
| `container` | either container attachment slot | Inventory slots contributed | MYKEA SCHLEPPRAUM-8 (8), Scrap Box (3), Freight Harness (6) |

The suit's slots are authored once in `balance.carrying` (one Mining-tool slot,
two container attachments); an item names its kind, never a slot. Slot
compatibility, container capacity and the equipped Mining tool
(`EquipmentLoadout.miningTool`) are derived in `game/domain/equipment.ts`; Mining
reads the equipped tool's durations, charge and yield from `game/domain/mining.ts`;
the last-usable-Cutter guard, Power Cell loading, and every Inventory, Equipment,
Cargo Hold and Mining presentation of charge read the same definition. No
consumer branches on a particular item ID.

Equipping a Mining tool whose Mining requirement the character has not met is
refused by the equipment command (the Equipment surface lists it as a blocked
candidate with the requirement); an equipped tool whose requirement is not met is treated by
Mining as no usable tool.

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
  Drop, Use, or Destroy action. Carried equippable gear (Mining tools and
  containers alike) gets an Equip action, below.
- `Drop 1` and `Drop stack` are available for stack rows only. Both require an
  inline confirmation stating the item, the exact quantity, and that dropped
  items are **permanently destroyed in the current development build**. The
  server-authoritative `discardInventoryStack` command locks the owned stack,
  validates the confirmed quantity after any due-work reconciliation, and
  refuses safely when the stack changed, and refuses units a Fabrication
  workpiece has reserved (#232). Real ground items, map coordinates,
  visibility to other players, pickup, and player-to-player transfers remain
  future work; no world object is created by dropping. Selling to an approved
  NPC merchant is a separate authoritative command (see Credits below), not a
  drop or a transfer.
- Inventory Equip (#68, extended by #363) is offered for every carried unique
  item that any authored equipment slot lists in its `eligibleItems`, with no
  item-ID branch. Inventory only allocates to an EMPTY compatible slot (the first
  in authored order, so Container 1 before Container 2). When every compatible
  slot is occupied it never picks one: the disabled Equip explains this and a
  **Manage Equipment** button switches the shared overlay to the Equipment tab,
  where the player chooses the slot to replace. An item the authoritative
  evaluator refuses (Mining level, container capacity, mass) stays inspectable
  with the reason. Each eligible item carries `blockedReasons` (every blocker,
  Mining requirement included), produced by `evaluateEquipmentChange` (the
  refusal-as-data form of `planEquipmentChange`), so the projection and the
  equip command share one rule set; the command still re-validates and its
  refusal is shown as-is.
- The Equipment tab (#364) is a compact two-column slot grid: the Mining tool
  spans a row and the container attachments pair beneath it, drawn only from
  the authoritative `equipment.slots` (gloves and boots will pair the same way
  once real slots exist). Occupied slots show the item's artwork; empty slots
  show a category silhouette. Selecting any slot opens ONE details panel beneath
  the grid: the equipped item with Unequip (and, for the Mining tool, Power Cell
  charge and Load), plus every carried item compatible with that slot, blocked
  ones included. A blocked candidate is inspectable with all its reasons and a
  disabled Equip; an eligible one equips into exactly the selected slot.
- Inventory Power Cell loading is a convenience route to the same
  server-authoritative `loadMiningToolPowerCell` command and transaction the
  Equipment surface uses, via the same `loadPowerCellAction` client action. It
  is enabled only when the authoritative state shows a loose cell, an equipped
  depleted Cutter, and no conflicting command in flight, and it explains the
  reason whenever it is unavailable. Equipment remains the full Cutter
  charge/status surface.

- **Break Apart (#367)** is offered for the item the balance names as the Break
  Apart input (the intact Runestone), as a sibling of Drop in a stack's Item
  Details. It requires its own confirmation (destroy 1 Runestone, receive exactly
  5 Rune Fragments, irreversible), is disabled only while another command is in
  flight, and shows the server's refusal as-is (not enough slots or weight, or
  "Inventory changed"). On success the returned authoritative state replaces the
  Inventory; a selected stack that no longer exists clears the selection through
  the shared selectable-details contract. See "Rune materials".

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
  pricing, or player-to-player exchange. The one limit is per character, not
  per shop: a price line may author a `dailySellLimit` (below).

### Merchant daily purchase limits (issue #230)

Ahead of Fabrication, two lines are capped per character per RuneSpace Pacific
reset date: Wade sells at most **12 Scrap Metal** (4 Credits each; he buys it
back at 1) and Bix at most **12 Power Cells** (12 Credits each; he buys them
back at 4). The limit is authored on the price line (`dailySellLimit`,
`game/content/merchants.ts`) and never mirrored anywhere else.

- The reset date is the shared `pacificResetDate` boundary the Annex and the
  ForceSales refresh use (`game/domain/daily-reset.ts`). Nothing is cleared at
  midnight; a new reset date simply has no ledger row yet.
- The ledger is `character_merchant_daily_purchases`, one row per
  `(character, merchant, item, reset date)` holding the quantity bought that
  day. Wade's Scrap row and Bix's Cell row are independent records, and the
  table is separate from the Annex claim and ForceSales refresh ledgers.
- The purchase command reads today's row under the character lock it already
  holds, refuses a request larger than what is left (`daily_limit`), and only
  after every other refusal has passed consumes the allowance with a guarded
  upsert (the increment applies only while the new total stays within the
  limit) — in the same transaction as the Credit and inventory change. A
  refused or rolled-back purchase spends none of it; concurrent or retried
  requests cannot take a line past twelve.
- The cap counts units bought from that line today, not units owned. Selling
  back never restores it, and stock from anywhere else (the Annex, 10,000
  Hours' six Scrap) never counts against it.
- Play state projects `merchantDailyPurchases` (limit, purchased, remaining per
  line) so the Trade row can show what is left today and cap Max; the server
  alone decides.

### World Location merchants (issue #190)

A merchant is authored once and referenced by its venue. A Local Place names the
merchant it hosts (#159); a World Location may do the same, which is how Wade
trades out of his own yard rather than a room in a town. The merchant itself
owns its prices and its authored unlock: `authorizingMissionId` names the
Mission whose **acceptance** opens the counter, revalidated server-side against
the character's own accepted record, and it stays open after that Mission
completes. Wade sells Scrap Metal at 4 Credits and buys it back at 1, with no
stock row or restock timer — only the per-character daily limit above (#230);
Bix's Local Place path is unchanged.

The Trade surface presents only the directions the authored price table
supports, derived generically by `merchantTradeDirections`: a merchant with no
purchase prices is Sell-only, one with no buy prices is Buy-only, and a merchant
who does both keeps the Buy/Sell toggle. With one direction there is no toggle
at all and the heading names it, so Wade's counter never opens an empty Sell
tab. This is read from content, never from which merchant it is, and it is not a
reason to author a price merely to fill a tab.

### Completed-Mission merchant unlock and Last Leg Trading (issue #357)

A merchant authors at most one unlock. `authorizingMissionId` (above) opens it on
**acceptance**; `requiredCompletedMissionId` opens it on **completion** — the
Mission accepted, finished and turned in, read from the same completed-Mission
record Local Place access and NPC relocation read. It authors its own
`lockedMessage`, the schema rejects a merchant that authors both unlocks or
only half of this one, and there is no second unlock flag. `isMerchantOpen`
takes both the accepted and the completed sets, and the `tradeWithMerchant`
command revalidates the completed record under the character lock before
quoting **either** direction, refusing with `merchant_locked`, so a hidden button
is never the gate. Wade's and Bix's behaviour is unchanged. The Trade control
for a completed-Mission merchant stays visible while locked and shows the
authored message instead of the counter (an accepted-Mission merchant still
presents no Trade at all until it is met).

**Last Leg Trading** (`MERCHANT_IDS.lastLegTrading`, fronted by Toll Kade, hosted
by the Local Place of the same name at Holo Hollow Landing) requires a completed
`thrust_issues` — not an accepted one, not a repaired-but-unreported ship, not
another character's completion — and not Move Along or any flight. First-pass
balance, all read from the merchant registry:

| Item | Player buys | Player sells | Daily limit (per character, Pacific day) |
| --- | --- | --- | --- |
| Full Small Fuel Canister | 225 Cr | 160 Cr | 5 |
| Empty Small Fuel Canister | 40 Cr | 25 Cr | 5 |
| Oil Shale | not sold | 6 Cr | none |

The two canister limits are separate lines in the ordinary merchant daily
ledger (#230): selling back never restores an allowance, and another character
has their own. The ledger keys on the **merchant ID**, which names the Last
Leg Trading *business*, so the affiliated Stillreach terminal (#375, above)
references the same merchant and shares these allowances. A multi-merchant stock
platform, rotation and new stock are not built.

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
  A conversation backdrop follows the same rule (#292): Curly's unfinished room
  names its finished counterpart (`repaired` in
  `game/content/conversation-backgrounds`), and every beat set there is shown
  in whichever state the mount's repair is in.
- HH B&B is the first place with **two residents** (#292): Mara and her guest
  Curly, each with their own contact card, both behind the same Keep the
  Change door. Curly's room is conversation scenery, never a place to enter.
- Ordinary World Locations are unaffected: a location with no authored Local
  Places renders and behaves exactly as before.

## Approved identities and boundaries

Near-term stable skills are Mining, Refining, Welding, Fabrication (#232),
Runeworking (#391), and Strength. Stable
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
deterministic 5-tick increments for 600 total XP. Fabrication (#232) assembles
finished objects from processed stock — see "Fabrication and Tinkering" above.
Salvage dismantles and recovers components; Machining creates precise
components. Salvage, Machining, Speeder Piloting, and Ship Piloting are
documented future skill directions only; they have no persistence
initialization or gameplay in this foundation.

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

- **Holo Hollow Landing** (`holo_hollow_landing`, `{q:1,r:1}`, issue #357):
  Skatboll's landing pad, an ordinary World Location rather than a separate
  planet, open to anyone on foot from the start. It hosts no activity, no ship
  state of its own and no merchant of its own; its one Local Place is **Last
  Leg Trading**. Once a character's Rivet flies there (#358) the pad shows that
  ship and the Ship panel is available there.
  Walking edges, all the standard 24 seconds and bidirectional: **Crash Site**,
  **Abandoned Processing Yard** and **South Access Track**. There is no link to
  The South Cut and no ship moves when a character walks here.

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
- A separate explicit confirmation control ("Walk to … — 24 sec", shown as
  "Walk — 24 sec" in the selected-destination panel, #240) invokes the
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
  invariant cannot be violated by any command. A walk may also carry `NULL`,
  but only while Scavenge is suppressed after a Turn Back (below).

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
  tick in the inclusive range **3–30** (none while suppressed, below). The
  opportunity is open for **5 ticks = 3 seconds**, then is permanently missed;
  arrival, replacement, or Turn Back ends the leg and its opportunity. The server accepts a
  claim for one additional second after the client-visible expiry to absorb
  network delay; this grace does not extend the visible or clickable window.
- Claiming is a server-authoritative transaction. Capacity is preflighted for
  every mutually exclusive maximum branch before one weighted roll; the roll,
  inventory award, and claim marker commit exactly once. The universal table is
  fixed at 10,000 basis points: 750 each for Zilch, Nothing Burger, Nada, and
  Whammy!; 2,000/1,250/750 for Ferrite Shale x1/x2/x3; 750/500 for Power Cell
  x1/x2; and 1,000/750 for Refined Ferrite x1/x2. No-find outcomes award no
  item, XP, or Slag.
  The table is location-agnostic, so a walking leg on Stillreach (#373, reached by the
  Rivet since #375) offers the same window and table as one on Skatboll; neither slice
  adds a Stillreach drop rule or balance, and whether it should is an open product
  question.
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

### Turn Back and Scavenge suppression (issue #312)

- **Turn Back** is a player command on an active Journey, walk or ride. The owned
  character is locked and Travel reconciled first, so **arrival wins**: a Journey
  already due commits its arrival and Turn Back finds nothing to cancel; there is
  no "too late" window and the client countdown is never authoritative. A Journey
  that remains has its Travel action and `character_travel_state` cleared
  together. `current_location_id` is the origin for the whole Journey and is not
  touched, so the character is idle at the origin: no halfway place, no return
  trip, elapsed progress discarded. A retry, or a forged request while not
  traveling, is a no-op that returns authoritative state.
- Committed Scavenge rewards and reveals are never rolled back; an unclaimed
  opportunity lives on the travel row and disappears with it. An operator
  force-idle shares the same clearing helper but never sets suppression.
- Cancelling a **walk** sets `characters.scavenge_suppressed` — even before that
  Journey's opportunity appeared, so cancelling cannot reroll the random window.
  While set, a new walk stores no Scavenge window (NULL), spends no random roll,
  and `claimScavenge` refuses with `scavenge_suppressed`. Starting or cancelling
  further walks, reloading, logging out and in, and any Crew Hauler ride neither
  clear it nor are affected by it. It clears only when a **walking** Journey
  arrives.
- Cancelling a **ride** is immediate and not refunded (the fare was debited at
  boarding), and neither sets nor clears suppression.
- The flag is projected as `PlayGameplayState.scavengeSuppressed` and, per
  Journey, `travelState.scavengeSuppressed`, so the UI states it rather than
  holding a client-only latch.

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
  Character Level badge with a chevron affordance (the same canonical level the
  profile it opens shows; issue #213) — and the row of the character whose
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
- **Overall-level rule:** the level shown is the canonical **Character Level**
  defined below (issue #213), consumed from the one shared implementation. It
  replaced this panel's original "highest published skill level" rule, which
  was a second definition of a character's level. No total-level field is
  persisted and no formula is duplicated in the UI.
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

### Character Level and the Character surface (issue #213)

**Character Level** is the one overall level RuneSpace publishes:

```
Character Level = 1 + Σ(skillLevel - 1)
```

A character starts at Level 1 and every skill level earned above the starting
level adds exactly one Character Level. Mining 1 / Refining 1 / Welding 1 is
Character Level 1; Mining 4 / Refining 2 / Welding 1 is 5; Mining 8 /
Refining 8 / Welding 5 is 19. This is deliberately **not** the sum of raw skill
levels: because every skill begins at Level 1, a skill the player has not
trained contributes zero, so adding a new skill to the game cannot move any
existing character's level.

- **One implementation:** `characterLevelFromSkillLevels` and
  `projectCharacterProgression` in `game/domain/character-progression.ts`. The
  same-location population list, the same-location profile panel, and the
  Character surface all consume it; nothing re-derives it.
- **Derived, never persisted:** Character Level has no XP track, no stored
  column, and no separate progression of its own, so a change to the skill
  catalog needs no migration or backfill.
- **Which skills count:** every skill in `SKILL_IDS` with both an approved
  level curve (`skillLevelThresholds`) and an approved player-facing name
  (`game/content/skill-presentation.ts`). A skill with neither has no truthful
  level and is neither presented nor counted — Strength today. A future skill
  appears on every progression surface as soon as those two content boundaries
  define it.
- **Character surface:** the far-left footer destination is **Character**. It
  opens the current character's profile in the shared modal Drawer, the same
  interaction pattern as Inventory: portrait, name, Character Level, Credits
  (also shown in Inventory, deliberately), and one row per presented skill with
  its level and progress through that level. There is no overall-character XP
  bar. A sticky **Switch Character** action links to the existing `/characters`
  selection screen, so switching stays reachable however long the skill list
  grows; this surface adds no second selection or management experience.

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
Welding, Practice Welding, a Work Order, or Tinkering — never a Fabrication
workpiece, which is binding until it resolves, #232, and never a Runeworking
cycle, #391):

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
  24-hour timer. The calculation itself (`pacificResetDate`) lives in the
  shared `game/domain/daily-reset.ts` boundary rather than being Annex-specific
  code — `game/domain/power-annex.ts` re-exports it under its original name so
  every existing import and this section's DST/local-midnight behavior are
  unchanged. Work Orders' ForceSales daily board refresh (issue #217,
  `docs/work-orders.md`) is the second consumer of the same boundary; each
  feature still keeps its own entitlement persistence.
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

### Mining Cutter Power Cell boost (issues #24 and #233)

This section was written for the Salvage Cutter and holds unchanged for it.
Since #233 it applies to whichever Mining tool is equipped, each against its own
authored definition (see "Equipment definitions" and the Mining slice): loading
and charge consumption are identical for both Cutters, but only a `speed` tool —
the Salvage Cutter — takes the 2× below. A charged Loadsteel Cutter keeps its
0.8× duration and adds one ore to each successful attempt instead.

- A loose `power_cell` is a 500 g fungible stack item with a stack limit of five.
  Issue #47's DeWhat? Emergency Power Annex is the renewable source; there are no
  starter or backfilled cells. Since #233 Fabrication 5 also makes them, two per
  batch.
- Loading one carried Power Cell into the equipped, depleted Mining Cutter
  consumes the cell completely and sets the Cutter's durable charge to its own
  maximum — ten for both current Cutters.
  Loading is allowed while idle or while another action is active; if Mining is
  active, due Mining work is resolved first in the same transaction. A nonzero
  charge cannot be overwritten.
- While charge is greater than zero, each next Mining attempt uses
  `ceil(toolAttemptTicks / 2)` (currently 5 ticks / 3 seconds with the Salvage
  Cutter at Ferrite Shale). For the Salvage Cutter the boost changes timing only:
  success chance, random rolls, yield, XP, inventory planning, and progression are
  unchanged. A Loadsteel Cutter's charge changes no timing; it adds one ore to
  each successful attempt's ordinary yield when that ore fits.
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
teleportation, recalls, Travel cancellation (shipped later in #312), background workers, WebSockets,
client-authoritative timers, Phaser/canvas/WebGL map rendering, and Inventory/
Equipment overlay polish from issue #41 are all explicitly out of scope here.
