# Work Orders — Board Rules and the Client Pool

## Status and scope

**Work Orders are implemented and playable** (issue #207, on the foundation
issue #190 laid down). The Work Orders terminal at Rusk Recovery becomes a
real surface — instead of scenery — once **10,000 Hours** is completed, and
becomes the player's own once **10,001 Hours** is **accepted**: a character
who has accepted it can browse the board, accept a posting, Start/Resume
Welding it, and get paid on completion. See "The unlock" below for why
acceptance, not turn-in, is the gate.

At **Refining level 5** (issue #217), Galvanic Stock becomes craftable and
eight more jobs join the eligible pool — the original eight remain eligible
forever, unchanged, under their existing Welding-only rule. Reaching Refining
5 also unlocks **ForceSales Free's daily board refresh**: one player-initiated
full-board refresh per RuneSpace Pacific calendar day, plus an optional Wade
conversation topic. See "ForceSales daily refresh" below.

This document owns the **content and product** side: the settled board rules,
the rule for choosing a client, the authored pool of sixteen jobs, the payout
and XP rules the pool is authored against, and the ForceSales daily refresh.
The runtime mechanics Work Orders share with every other kind of Welding — the
Clean Pass cadence, the one-bench exclusivity rule, and the offline/Stop/Travel
contract — are recorded once in `docs/gameplay-foundations.md` and are not
repeated here.

Implementation: `game/content/work-orders.ts` (the pool),
`game/domain/work-orders.ts` (payout, XP, eligibility, selection, board
refresh, and the load-time validation), `game/config/balance.ts`
(`workOrders`, `welding.cleanPass`), `server/work-orders.ts` (the durable
board and its completion), `server/work-order-commands.ts` (Accept/Start/
Stop), `server/work-order-refresh.ts` (ForceSales' daily refresh command),
`game/domain/daily-reset.ts` (the shared RuneSpace Pacific reset-date
boundary, also used by the Power Annex), and `db/rune-space.ts`
(`character_work_order_postings`, `character_work_order_board_refreshes`).

Related: `docs/npc-canon.md` (internal character canon and the client-
eligibility rule), `docs/holo-hollow.md` (settlement, economy, tone),
`docs/missions.md` (the Mission framework, which Work Orders are **not**),
`docs/gameplay-foundations.md` (Clean Pass, Workbench exclusivity, and the
shared offline/Stop/Travel contract Work Orders reuse rather than reimplement).

## Shipped board rules

- **Sixteen authored jobs** in the pool today (`WORK_ORDERS` in
  `game/content/work-orders.ts`): the original eight, Welding-5-only forever,
  plus eight more that additionally require **Refining 5** (#217). A job's
  optional `requiredRefiningLevel` is the only new field — there is no runtime
  "tier" concept, and the two groups are not stored, selected, or eligibility-
  checked any differently from each other beyond that one extra comparison.
- **Exactly 3 distinct posted jobs** visible at once (`workOrders.postedSlots`).
- **One active Work Order per character**, enforced as a database invariant, not
  merely a rule every command has to remember: `character_work_order_postings`
  carries a partial unique index on `character_id` where
  `accepted_at IS NOT NULL`, so a retried or concurrent acceptance cannot
  create a second one.
- Accepting a posting **leaves that row on the board**, marked In Progress: the
  same row's `accepted_at` becomes non-null. There is no second table for "the
  active job" that could disagree with the board about what is on the bench.
- Completion **immediately refills that same slot** from the eligible pool
  (`refillWorkOrderSlot`) — the slot index never moves and the other two
  postings are untouched.
- **There is no Abandon.** No Abandon button, command, refund, or reroll exists
  anywhere in the shipped implementation, and none should ever be inferred from
  this document's own drafting history. The only way an accepted job leaves the
  bench is finishing it. Every rule below that used to describe abandonment as
  a second clearing path has been removed rather than reworded, because the
  design was explicitly dropped, not merely renamed.
- **No automatic rotation, ever.** Midnight, a level-up, or reaching Refining 5
  never mutates a posted slot on its own. A slot's job changes only when that
  slot's job is completed, or the player deliberately spends their day's
  ForceSales refresh (see "ForceSales daily refresh" below). Leaving the board
  alone forever leaves it exactly as durable as it always has been.
- A refill never duplicates another currently posted job, and never
  immediately redraws the job just completed while another eligible option
  exists (`selectWorkOrderRefill`; see "Selection and refill" below).
- Welding level (and, since #217, Refining level for the jobs that author a
  floor) expands the eligible pool later; **lower-level jobs stay eligible
  forever** (`eligibleWorkOrders` filters both by `>=`, never by exact tier).
- The original eight use **Refined Ferrite** as their base repair material;
  two of them (Tansy's and Otis's) also require **Power Cell**, because their
  fiction is that a Cell was physically destroyed. All eight remain Welding
  level 5 only, so the pool's own gate and the board's minimum Welding level
  (`workOrders.requiredWeldingLevel`, also 5) coincide for that group.
- The eight Refining-5+ jobs (#217) use **Galvanic Stock** as their base
  conductive-repair material — the reason Refining 5 matters at all, since
  the material is what a repair genuinely needs rather than a label for "the
  new tier". Four of them (Mott, Kells, Larkin, Stemp) also require
  **Refined Ferrite** for structural members, and three (Tansy, Larkin,
  Stemp) also require **Power Cell** because their fiction destroys one,
  following the same "material follows the fiction" rule as the original
  eight.
- Real Work Orders use genuine Welding and pay **40% of the global Welding
  XP per section** — double Practice's share, well under an authored story
  repair's full rate. See "Welding XP" below.
- Payout exceeds the direct-sale value of the material a job consumes by a
  fixed labor premium, and every authored payout is validated against the rule
  that produces it. See "The payout rule" below.

### Completion is a transaction, not a scene

> **Repeatable Work Orders are shop jobs, not miniature Missions. Their
> completion does not carry bespoke client dialogue.**

None of the sixteen jobs authors a completion scene. Completion is a database
transaction (`completeActiveWorkOrder`): it pays the Credits, credits the
Mission's generic `work_order` tracked-activity counter, and refills the slot,
all under the guard of the same update that claims the completion — so a retry
or a completion discovered by lazy reconciliation while the player was away
pays exactly once. The client-facing acknowledgement is a compact success
callout naming the job and the payout ("*\<title\>* complete" / "Paid *N*
Credits"), the same shape for every job in the pool; a finished bracket does
not summon its client for a conversation.

A later special contract may deliberately carry authored dialogue or a
narrative completion beat, but that is outside this system and has to be
earned by a specific content need rather than assumed as the default shape.

### The payout rule

One rule, applied to every job, and checked against every authored value at
module load (`workOrderPayoutCredits` in `game/domain/work-orders.ts`):

```
rawPayout = baseCredits + sections × creditsPerSection
          + materialReplacementValue × materialPremium
payoutCredits = roundUp(rawPayout, roundUpToCredits)
```

with the authored constants (`balance.workOrders.payout`):

| Constant | Value |
| --- | --- |
| `baseCredits` | 25 |
| `creditsPerSection` | 3 |
| `materialPremiumBps` | 11,000 (110%) |
| `roundUpToCredits` | 5 |

so in full: `rawPayout = 25 + sections × 3 + materialReplacementValue × 1.10`,
rounded **up** to the next 5 Credits. The fixed base keeps a short job
genuinely attractive on a Credits-per-minute basis instead of every job
collapsing to the same perfectly scaled rate.

`materialReplacementValue` is **what the player would pay to replace the
consumed material**, derived from the merchant registry rather than restated
as a second price table (`workOrderMaterialReplacementValue`): a merchant's
*sell* price is preferred when one exists, because that is the real cost of
replacing the unit the player gave up; where nobody sells the item, the best
available buy-back price is the only honest valuation there is. Today that
resolves to **Refined Ferrite at 10 Credits** (Bix buys it at 10 and no one
sells it) and **Power Cell at 12 Credits** (Bix sells it at 12, which outranks
his 4-Credit buy-back; it was 8 until #230 repriced Cells, which moved every
Cell-consuming payout below). A merchant price change moves this value automatically
— nothing here is a frozen second constant.

`validateWorkOrderDefinitions` recomputes `workOrderPayoutCredits` for every
authored job at module load and refuses to start the server if a stored
`payoutCredits` has drifted from what the rule now derives — for example, if a
merchant price change moved a replacement value and nobody updated the
authored jobs that consume it. The number the board shows a player and the
number the server pays can never quietly diverge from the rule that produced
it.

Worked example — Renn's Split Carry Frame (2 Refined Ferrite, 8 sections):
`25 + 8×3 + 2×10×1.10 = 25 + 24 + 22 = 71`, rounded up to **75**, the authored
value.

### Welding XP

One global Welding XP-per-section (`welding.xpPerIncrement = 50`), shared by
every Welding work unit; each activity pays an authored share of it
(`practiceSectionXp`, `workOrderSectionXp`) rather than a second frozen number:

| Activity | Share | XP per section |
| --- | --- | --- |
| Practice Welding | 20% | 10 |
| Work Order | 40% | 20 |
| Authored repair (Cargo Hold, Crew Stop) | 100% | 50 |

A job's total XP is simply `sections × 20`; a job's `sections` is therefore
also its full XP budget, with no separate cap or completion bonus.

### The unlock: acceptance, not completion

`10,001 Hours` being **accepted** is the permanent authorization to use the
board — not its completion. Completing 10,000 Hours only turns the terminal
from scenery into a real (if then-empty) surface; accepting 10,001 Hours is
what makes it the player's business. Turning 10,001 Hours in afterward is Wade
looking at the finished work, and it is deliberately **not** a second gate: a
player whose 10,001 Hours objective already reads 1/1 keeps a fully usable
board — accept, weld, get paid, watch the slot refill — for as long as they
leave the Mission un-turned-in. `workOrderAccess` in
`server/work-order-commands.ts` checks acceptance, never completion.

### Shared offline, Stop, and Travel behaviour

Work Order Welding is not a separate timer engine; it reuses the same generic
one-active-action model every other Welding work unit uses:

- **Acceptance does not start timing.** `acceptWorkOrder` commits the recipe
  and puts the job on the bench In Progress, but starts no `active_actions`
  row. `startWorkOrderWelding` is a separate, explicit, authoritative action
  that begins or resumes Welding it — a job appearing on the bench is not the
  same event as a torch being lit.
- **The same generic one-hour offline cap as Practice.** Resolution uses the
  shared `STANDARD_OFFLINE_RESOLUTION_CAP_MS` cursor cap with no Work-Order-
  specific override; a customer job resolves lazily on the player's next
  authoritative touch exactly like Mining, Refining, Practice, and the
  authored repairs.
- **Stop and Travel both interrupt and preserve durable progress.** Stopping
  Work Order Welding, and Travel replacing it (it is on the shared
  travel-replaceable action list), both close any open Clean Pass window as
  missed (`missOpenWorkOrderCleanPass`) and leave `sectionsCompleted` exactly
  where it was — never refunding materials, never producing an early payout,
  never rerolling the job's Clean Pass.
- **Offline time never auto-claims a Clean Pass.** An opportunity welded past
  while the player was away, exactly as while they are watching, is simply
  missed: the work's own resolved-section count already says so, and no
  durable write is needed to record it.

`docs/gameplay-foundations.md`'s Clean Pass and Workbench sections own the
general rule; this is only the confirmation that Work Orders opt into it with
no special case.

### Persistence shape

The whole board is **one table**, `character_work_order_postings`, with one
row per posted slot (three per character). This was a deliberate choice among
the options the original design left open (a repair-target row, a dedicated
table, or something else):

- `accepted_at` non-null is the **single authoritative definition** of "this
  posting is the active job" — there is no second `is_active` flag and no
  separate "current job" table that the board could disagree with about what
  is on the bench. "Which posting is In Progress" and "what is on the bench"
  are the same fact, and giving them two homes is exactly how they come to
  disagree.
- The partial unique index (`character_work_order_postings_one_active_idx`,
  on `character_id` where `accepted_at IS NOT NULL`) makes "at most one active
  Work Order" a database invariant, not a rule every command has to remember
  to check.
- A second unique index (`character_work_order_postings_distinct_jobs_idx`,
  on `character_id, work_order_id`) makes "the board never posts the same job
  twice" a database invariant too.
- **A refill replaces that slot's job in place.** `refillWorkOrderSlot` updates
  the same row — new `work_order_id`, `accepted_at` and `cleanPass` cleared,
  `sections_completed` reset to zero, `posted_at` bumped — rather than deleting
  and inserting a row or reshuffling slot indices. The other two postings keep
  their jobs and their positions, because the board is a shop queue, not
  something that reshuffles itself whenever the player finishes a job.
- The `cleanPass` column is the same JSON array shape every current Welding
  work unit persists (see `docs/gameplay-foundations.md`, Clean Pass): rolled
  once when a job is accepted, and cleared back to `NULL` the moment that job
  completes or is refilled out of the slot.
- A check constraint (`..._progress_requires_acceptance`) enforces that an
  unaccepted posting can never carry progress or a Clean Pass roll — a listing
  is not a piece of work, so a split state there is corruption, not a valid
  intermediate.
- An untouched board is simply three absent rows (`ensureWorkOrderBoard` seeds
  them lazily on the first authoritative touch after acceptance, exactly as
  Practice's row is seeded lazily), so nothing needed backfilling when the
  table shipped.
- **ForceSales' daily refresh entitlement is a separate table**
  (`character_work_order_board_refreshes`, #217), not a new column here: a
  refresh row's job is "has this character used today's refresh", which has
  nothing to do with what any individual slot currently holds, and folding it
  into this table would only tie two unrelated facts together. Its primary key
  is `(character_id, reset_date)`, so committing it is exactly the
  "insert-or-lose-the-race" shape the entitlement needs.

## ForceSales daily refresh

The Work Orders terminal runs **ForceSales**, a generic commercial SaaS
product — not software built specifically for Wade or Rusk Recovery. Wade
uses the free tier, and the terminal names it as restrained secondary flavor
("Powered by ForceSales Free") without renaming the panel's own identity away
from Work Orders.

At **Refining level 5, once the board is also unlocked** (10,001 Hours
accepted), ForceSales Free exposes one small player-controlled action: a
manual full-board refresh, once per **RuneSpace Pacific calendar day**
(`America/Los_Angeles`), per character. Reaching Refining 5 before the board
is unlocked, or the reverse, both resolve correctly: the refresh becomes
available the moment both conditions hold, with no missed window either way
(`refreshWorkOrderBoard` in `server/work-order-refresh.ts` checks both
authoritatively, alongside the board's existing location/Travel access rule).

### What one refresh does

- **Replaces every currently unaccepted posting at once.** With no active job,
  all 3 postings are replaced; with one **In Progress**, that posting is
  preserved exactly — never removed, rerolled, reset, or touched — and the
  other 2 are replaced.
- **Refreshing while a job is In Progress is explicitly allowed.** It is not
  treated as the bench being "busy" the way accepting a second job is.
- **Selection reuses the board's existing distinct-posting rule**, generalized
  to a whole batch (`selectWorkOrderBoardRefresh` in
  `game/domain/work-orders.ts`): each replacement excludes the active posting,
  every posting being refreshed, and any replacement already chosen earlier in
  the same refresh, so a refresh cannot draw one job into two slots. When
  those exclusions would leave a slot with no eligible option, the
  just-cleared jobs become drawable again for that slot only — the same
  graceful-fallback shape `selectWorkOrderRefill` already uses for a single
  slot, applied slot by slot across the batch.
- **The entitlement is consumed only when the replacement genuinely commits.**
  A refused command, a network interruption, or a rolled-back transaction
  never burns the day's refresh (`commitWorkOrderBoardRefresh` in
  `server/work-orders.ts` inserts the day's entitlement row with
  `onConflictDoNothing` and only then updates the board rows, inside the same
  transaction the rest of the command runs in — a lost race reports
  `already_refreshed_today` rather than double-spending).
- **Midnight itself never touches a posting.** The daily boundary restores
  refresh *eligibility* only; an untouched board stays exactly as durable as
  it always has been if the player never presses Refresh.

### Shared daily-reset boundary

The Pacific calendar-day calculation is shared with the Power Annex, not
duplicated: `pacificResetDate` now lives in `game/domain/daily-reset.ts`
(`RUNESPACE_RESET_TIME_ZONE = "America/Los_Angeles"`), and
`game/domain/power-annex.ts` re-exports it under its original name so every
existing Annex import, and its DST/local-midnight test coverage, is unchanged.
The refresh's own entitlement is still its own table
(`character_work_order_board_refreshes`, keyed on `character_id, reset_date`)
rather than folded into the Annex's claims table — the two features consume
their reset date the same way without sharing persistence that has no reason
to be shared.

### First-ever refresh: the NEW treatment

The refresh area shows a **NEW WORK AVAILABLE** treatment the first time a
character becomes eligible for it, and keeps showing it — across reconnects,
logins, and days — until that character's **first successful refresh ever**
commits. This is derived from durable refresh history
(`loadWorkOrderRefreshState`: "does any row exist for this character at all,
regardless of date") rather than a standalone tutorial-seen flag or a
one-frame level-up event that could be missed.

### Settled UI copy

The terminal shows exactly one of these states, chosen from the authoritative
projection (`WorkOrderRefreshProjection` in `server/play.ts`) alone:

**First-unlock** (`firstUnlock && availableToday`):

> **NEW WORK AVAILABLE**
> Your contractor profile now qualifies for conductive repair work.
>
> ForceSales Free has unlocked 1 complimentary queue refresh per day. Refresh
> now to pull from your expanded job pool.
>
> **Refresh Board — Free**

**Normal available** (`!firstUnlock && availableToday`):

> **ForceSales Free · 1 refresh available today**
> Replaces all unaccepted postings. In Progress work stays put.
>
> **Refresh Board**

**Used for today** (`!availableToday`):

> **ForceSales Free · Daily refresh used**
> Additional refreshes require ForceSales Pro.
> Contact your Network Administrator to authorize an upgrade.

There is deliberately **no Upgrade button** here — ForceSales Pro is a joke
about Wade, not a purchasable feature, and no paid or additional-refresh path
exists.

**Successful refresh:**

> Queue refreshed. New postings loaded.

### Wade's ForceSales topic

Wade gains one optional, replayable conversation topic once the board is
unlocked **and** the character has reached Refining 5 — the same
`refresh.unlocked` fact the terminal itself reads, via the conversation
resolver's `work_orders_refresh_unlocked` availability kind
(`game/domain/conversation.ts`). It is flavor, not a Mission, tutorial
requirement, or forced interruption; the player character stays silent
throughout, per the shipped topic model (`game/content/dialogue.ts`,
`DIALOGUE_IDS.wadeForceSalesTopic`).

## Choosing a client

> **Work Order clients do not need to have been met, and do not need to be
> interactable NPCs.** A named client may be an established NPC or a
> background resident introduced through authored job fiction. Player
> encounter chronology does not determine whether that person can use Rusk
> Recovery.

Holo Hollow exists independently of the order the player walks through it. A
resident's dolly is buckled whether or not the player has met them, and a real
local repair business has customers the player has not been introduced to. A
player recognising a name from the board and meeting that person later is a
feature, not a leak.

**Eligible established NPCs:** Tansy Rusk, Bix Weller, Renn Calder, Mara Kells.

**Wade Rusk is excluded from the pool.** This is a framing decision, not a
chronology one: he owns the yard, the bench, and the terminal the paying work
arrives through, so making him one of the customers would blur *Wade assigning
work around his own shop* with *customers bringing paying work in*. Direct
apprentice or shop work from Wade remains available to later content.

Rules that hold for every job:

- Use an established NPC **only** where the item genuinely reinforces their
  established work, business, equipment, or circumstances. Do not force one job
  per NPC to be tidy, and do not stack several onto one to hit a ratio.
- Prefer a **named** background resident over a label like "a local miner" when
  a real customer would plausibly be attached to the repair.
- A job must never assume familiarity the game does not guarantee: no "your
  friend", no "you remember", no callback to a conversation that may not have
  happened.
- A job must not casually reveal an unrevealed occupation, relationship, former
  career, possession, or story fact merely because it exists internally.
- Keep the work inside RuneSpace's ordinary blue-collar repair economy:
  brackets, frames, housings, carts, fixtures, machinery components, ordinary
  work equipment. No heroic, military, or high-stakes contract work.
- If a repair needs somebody to pay for it, establish a plausible named person.
  Do not treat abandoned or public infrastructure as privately commissioned.

### Background clients, kept deliberately small

A background client gets a name, an occupation, and the one possession the job
needs. Creating one does **not** add them to the interactable NPC roster, and
does not create a portrait, dialogue, a map presence, a Wiki character page, a
biography, or a promise that they become an NPC later.

Do not invent age, family, home, personality, history, relationships, or extra
possessions unless a job actually requires them. Some of these names may become
useful for future NPCs or Missions; others stay background residents forever.
Both outcomes are fine — ordinary residents are allowed to simply exist.

## The pool — sixteen Work Orders

### The original eight (Welding 5)

Common to all eight, and therefore not repeated per job:

- **Minimum Welding level:** 5.
- **Repair material family:** Refined Ferrite, with Power Cell added on the two
  jobs whose fiction destroys one.
- **Progression prerequisite:** none beyond the board's own gate (10,001 Hours
  accepted, Welding level 5). No job below needs a prerequisite of its own.

The complete shipped recipe, length, and payout for each job
(`game/content/work-orders.ts`; the payout column is validated against the
rule above at module load, so it can never drift from it):

| Job | Client | Materials | Sections | Payout |
| --- | --- | --- | --- | --- |
| Split Carry Frame (`renn_carry_frame`) | Renn Calder | 2 Refined Ferrite | 8 | 75 |
| Cracked Heater Housing (`voss_heater_housing`) | Greta Voss | 4 Refined Ferrite | 9 | 100 |
| Sagging Shelf Bay (`bix_shop_shelving`) | Bix Weller | 3 Refined Ferrite | 10 | 90 |
| Cracked Cutter Housing (`tansy_cutter_housing`) | Tansy Rusk | 4 Refined Ferrite + 1 Power Cell | 12 | 120 |
| Tourist-Era Bed Frame (`mara_bed_frame`) | Mara Kells | 5 Refined Ferrite | 13 | 120 |
| Speeder Cargo Rack (`stemp_speeder_rack`) | Juno Stemp | 6 Refined Ferrite | 14 | 135 |
| Binding Hand Winch (`larkin_hand_winch`) | Pell Larkin | 4 Refined Ferrite | 16 | 120 |
| Electric Cargo Dolly (`mott_cargo_dolly`) | Otis Mott | 8 Refined Ferrite + 3 Power Cell | 19 | 210 |

### Possession provenance — the standard for every job

An occupation making a possession *plausible* is not the same as canon having
*established* it. Every job below therefore separates the two:

- **Established canon** — what shipped content already says about this person.
- **New Work Order canon** — the possession, or the state of it, that this job
  introduces.

Do not describe a newly introduced possession as previously established merely
because the client's job makes owning one obvious. A miner plausibly owns a
carry frame; that is not the same as RuneSpace having said he does. Keep each
expansion to the one object the job needs, with no model name, age, history,
extra features, or second inventory of that person's tools.

### Authoring material ranges — guidance only, not a runtime concept

The original eight were authored against three rough sizes: **short** (2-4
Refined Ferrite), **medium** (3-6), and **long** (4-8). The Refining-5+ eight
(#217) instead range **2-5 Galvanic Stock**, **4-6 Refined Ferrite** where a
job also needs one, and **1-2 Power Cell** where a job also needs one — a
separate scale for a separate material family, not a continuation of the
Ferrite ranges above. Both sets of ranges are recorded here as guidance for
whoever authors the next job in either family, so it lands in a size that
family doesn't already have plenty of — they are **not** stored anywhere in
the runtime pool. Nothing in `WorkOrderDefinition` carries a size label; a
job's scale is expressed purely through its `materials` and `sections`, and
either set of ranges may be revised or ignored entirely once a real new job
proves what the next size needs.

### 1. Cracked Cutter Housing

- **ID:** `tansy_cutter_housing`
- **Client:** Tansy Rusk — *established NPC*
- **Item:** the housing of her own working cutter, including the Cell it
  carried
- **Materials:** 4 Refined Ferrite + 1 Power Cell · **Sections:** 12 ·
  **Payout:** 120 Credits
- **Terminal description:** "The Cell cradle has torn loose at one of the
  mismatched joints in Tansy Rusk's working cutter, and took the Cell in it
  with it. The housing wants re-laying straight and a fresh Cell fitted."
- **Established canon:** Tansy is a field mechanic and miner who works The Jag,
  and she builds functional equipment out of mismatched salvage and spares — she
  says of the cutter she made that nothing on it matches and that she threw it
  together from parts she had lying around. Keep the Change established that she
  does not leave the seam mid-shift for a part she needs.
- **New Work Order canon:** Tansy owns and uses a **separate working cutter**,
  built with the same practical mismatched-spares approach as her established
  engineering style. This job is that cutter failing at exactly the kind of
  joint her own account predicts: the Cell cradle tore loose at a mismatched
  joint of her own working cutter and took the loaded Cell with it when it
  went. The repair re-lays the housing straight and fits one replacement Cell
  — nothing about the cutter beyond that.
- **Why the pairing works:** her established engineering style predicts exactly
  this failure — a weld letting go at a joint between two parts that were never
  meant to meet — and her established working life explains why it reaches
  Wade's bench instead of her own hands.
- **Provenance caution:** the Salvage Cutter in shipped dialogue is the one
  Tansy **builds and gives to the player**. This job is emphatically **not**
  that cutter — it is the one she works with herself — and shipped content does
  not establish that she keeps a second one beyond what this job introduces. Do
  not cite the player's Cutter as evidence that this one already existed.
- **Canon notes:** `game/content/dialogue.ts` (`tansyCompletion`,
  `tansyAfterRemoteAcceptance`, `tansyMiningTopic`), `game/content/npcs.ts`,
  `docs/npc-canon.md` (Tansy → Work, business, and equipment context).

### 2. Sagging Shelf Bay

- **ID:** `bix_shop_shelving`
- **Client:** Bix Weller — *established NPC*
- **Item:** a shelf bay and its brackets in Holo Hollow Souvenirs + Mining Supplies
- **Materials:** 3 Refined Ferrite · **Sections:** 10 · **Payout:** 90 Credits
- **Terminal description:** A shelf bay in Holo Hollow Souvenirs is bowing under
  a load it was never built for. Bix Weller wants the brackets reinforced before
  the whole run of it comes down on somebody.
- **Established canon:** the shop, and its shelving — shipped content describes
  shelves of tourist-era trinkets sitting beside the mining supplies that
  actually sell, and Bix's own account of the place is that his parents filled it
  with shirts, mugs and little projector toys.
- **New Work Order canon:** that one bay of that established shelving is bowing
  and its brackets need reinforcing. No new fixture, and no new stock.
- **Why the pairing works:** his shop is the clearest case in town of fixtures
  outliving their purpose. Tourism-era shelving failing under ferrite-grade stock
  *is* his characterization, in one object.
- **Canon notes:** `game/content/local-places.ts`
  (`holo_hollow_souvenirs` description), `game/content/dialogue.ts`
  (`bixTheShopTopic`), `docs/holo-hollow.md` (Bix Weller).

### 3. Split Carry Frame

- **ID:** `renn_carry_frame`
- **Client:** Renn Calder — *established NPC*
- **Item:** his own ore carry frame, split at a strap mount
- **Materials:** 2 Refined Ferrite · **Sections:** 8 · **Payout:** 75 Credits
- **Terminal description:** A carry frame has split along the weld at the strap
  mount. Renn Calder works ferrite and needs it whole before his next shift.
- **Established canon:** Renn is a working Ferrite miner. That is all shipped
  content establishes about his work.
- **New Work Order canon:** Renn owns an ore carry frame used in his mining work.
  That is the whole expansion — no other tools, no vehicle, no home, no
  circumstances.
- **Why the pairing works:** the job is deliberately unglamorous and
  understated, which is his register, and a carry frame is the plainest possible
  piece of a working miner's own kit.
- **Provenance caution:** his occupation makes owning a carry frame obvious, but
  obvious is not established. This job is what establishes it.
- **Copy constraint:** Renn is **not** guaranteed to have been met. This job must
  read as a work order rather than a favour between acquaintances, and must not
  reference the Crew Stop or the Crew Hauler — that would foreground an optional
  Mission the player may never have found.
- **Canon notes:** `game/content/npcs.ts` (role: Ferrite miner),
  `game/content/dialogue.ts` (`rennFerriteTopic`), `docs/npc-canon.md`
  (Renn → Work, business, and equipment context; and the copy rule).

### 4. Tourist-Era Bed Frame

- **ID:** `mara_bed_frame`
- **Client:** Mara Kells — *established NPC*
- **Item:** a bed frame at HH B&B, gone at the corner joints
- **Materials:** 5 Refined Ferrite · **Sections:** 13 · **Payout:** 120 Credits
- **Terminal description:** One of HH B&B's bed frames has gone at the corner
  joints. The beds date from the years the rooms held families; they now hold
  miners and haulers, which is a different sort of weight. Mara Kells would
  rather it were welded than replaced.
- **Established canon:** she owns HH B&B, the rooms date from the tourism years,
  and her own account is that their contents did not change when the clientele
  did — "same beds, fewer complaints about the pillows". The beds themselves are
  established.
- **New Work Order canon:** one of those established bed frames has failed at the
  corner joints. Nothing else.
- **Why the pairing works:** a tourism-era bed frame giving out under working
  crews is her whole business model in one object.
- **Canon notes:** `game/content/local-places.ts` (`hh_bnb`),
  `game/content/dialogue.ts` (`maraTheBnbTopic`), `docs/holo-hollow.md`
  (Mara Kells — HH B&B).

### 5. Electric Cargo Dolly

- **ID:** `mott_cargo_dolly`
- **Client:** Otis Mott — *background resident*
- **Item:** the frame of his electric cargo dolly, buckled around the power rack
- **Materials:** 8 Refined Ferrite + 3 Power Cell · **Sections:** 19 ·
  **Payout:** 210 Credits
- **Terminal description:** "The frame on Otis Mott's electric cargo dolly has
  buckled around the power rack and taken three Cells with it. He hauls
  freight around the valley and cannot work without it."
- **Established canon:** hauling is part of Holo Hollow's adapted economy, and
  the town's inn explicitly serves haulers. The occupation exists; this person
  does not otherwise.
- **New Work Order canon:** Otis Mott is a local hauler and owns an **electric**
  cargo dolly. He/him. The job is that the dolly's frame buckled around its
  power rack and destroyed the three Cells riding in it; the repair straightens
  the frame and rack and fits three replacement Cells. Otis stays a background
  resident with no added biography beyond what this job needs.
- **Why the pairing works:** an electric dolly's power rack is exactly the part
  that turns a frame failure into a Cell loss, which is what makes this job the
  one that needs Power Cells rather than only Ferrite — a mechanical
  consequence of the vehicle, not an arbitrary tax.

### 6. Binding Hand Winch

- **ID:** `larkin_hand_winch`
- **Client:** Pell Larkin — *background resident*
- **Item:** a hand winch whose drum mount is bent, binding the cable under load
- **Materials:** 4 Refined Ferrite · **Sections:** 16 · **Payout:** 120 Credits
- **Terminal description:** The drum mount on Pell Larkin's hand winch is bent
  out of true, so the cable binds the moment there is any weight on it. It wants
  the mount cut back and re-laid straight.
- **Established canon:** mining crews are established in Holo Hollow, and they
  work a haul road and a shift. The crews exist; this person does not otherwise.
- **New Work Order canon:** Pell Larkin works a mining crew and owns a hand
  winch. He/him. Nothing else.
- **Why the pairing works:** a hand winch is ordinary worksite equipment a crew
  hand would own and use most days, and a bent drum mount is a wear failure
  rather than a dramatic one.

### 7. Speeder Cargo Rack

- **ID:** `stemp_speeder_rack`
- **Client:** Juno Stemp — *background resident*
- **Item:** the cargo rack on her speeder, cracked at the frame mounts
- **Materials:** 6 Refined Ferrite · **Sections:** 14 · **Payout:** 135 Credits
- **Terminal description:** The cargo rack on Juno Stemp's speeder has cracked at
  both frame mounts. She runs deliveries out of Holo Hollow, and the rack carries
  the entire load.
- **Established canon:** gig and delivery work is part of the town's adapted
  economy, and speeders already exist in the world — Rusk Recovery's own yard has
  damaged ones waiting their turn. The occupation and the vehicle class exist;
  this person and her speeder do not otherwise.
- **New Work Order canon:** Juno Stemp runs local deliveries and owns a speeder
  with a cargo rack. She/her. Nothing else. The speeder stays deliberately
  unnamed and unmodelled.
- **Why the pairing works:** a rack that carries the whole load is the part of a
  delivery runner's kit that fails first, and it needs no new worldbuilding.

### 8. Cracked Heater Housing

- **ID:** `voss_heater_housing`
- **Client:** Greta Voss — *background resident*
- **Item:** the housing of her room heater, cracked through at a seam
- **Materials:** 4 Refined Ferrite · **Sections:** 9 · **Payout:** 100 Credits
- **Terminal description:** The housing on Greta Voss's room heater has cracked
  through at a seam, and it will not hold a Power Cell safely until it is closed
  up again.
- **Established canon:** the Annex's whole public purpose is keeping "heat,
  comms, or a tool alive", so Power-Cell heating is established as an ordinary
  domestic need out here. This person does not otherwise exist.
- **New Work Order canon:** Greta Voss is a resident of Holo Hollow and owns a
  Power-Cell room heater. She/her. Nothing else — **no occupation**, because the
  job does not need one.
- **Why the pairing works:** this is the one job on the board that is not about
  somebody's trade, which is deliberate: the shop serves the town, not only its
  workers.

### The Refining-5+ pool (Welding 5 + Refining 5) — #217

Common to all eight, and therefore not repeated per job:

- **Minimum Welding level:** 5 (the same floor as the original eight).
- **Minimum Refining level:** 5 — the only new field on `WorkOrderDefinition`,
  `requiredRefiningLevel`, checked by `eligibleWorkOrders` alongside the
  existing Welding comparison and authoritatively revalidated by
  `acceptWorkOrder` server-side exactly as Welding already is.
- **Repair material family:** Galvanic Stock, with Refined Ferrite added for
  structural members and/or Power Cell added where the fiction destroys one
  (see the per-job list above).
- **Every client here already has a job in the original eight.** Reusing them
  is deliberate worldbuilding — Holo Hollow is small enough that one person
  plausibly brings a shop two different repairs over time — not a shortage of
  names, and none of the four background clients (Voss, Mott, Larkin, Stemp)
  is promoted to the interactable NPC roster by receiving a second job.
- **Progression prerequisite:** none beyond the board's own gate plus Welding
  5 and Refining 5. No job below needs a prerequisite of its own.

The complete shipped recipe, length, and payout for each job
(`game/content/work-orders.ts`; validated against the same payout rule at
module load):

| Job | Client | Materials | Sections | Payout |
| --- | --- | --- | --- | --- |
| Countertop Cooker (`voss_countertop_cooker`) | Greta Voss | 2 Galvanic Stock | 10 | 95 |
| Powered Souvenir Display (`bix_souvenir_display`) | Bix Weller | 3 Galvanic Stock | 11 | 120 |
| FurBaby™ Repair (`tansy_furbaby_repair`) | Tansy Rusk | 2 Galvanic Stock + 1 Power Cell | 12 | 115 |
| Helmet Charging Rack (`renn_helmet_rack`) | Renn Calder | 4 Galvanic Stock | 13 | 145 |
| Portable Cargo Scale (`mott_cargo_scale`) | Otis Mott | 3 Galvanic Stock + 4 Refined Ferrite | 15 | 175 |
| B&B Linen Press (`mara_linen_press`) | Mara Kells | 3 Galvanic Stock + 5 Refined Ferrite | 16 | 190 |
| Powered Cable Puller (`larkin_cable_puller`) | Pell Larkin | 4 Galvanic Stock + 5 Refined Ferrite + 1 Power Cell | 18 | 230 |
| Speeder Power Cradle (`stemp_speeder_cradle`) | Juno Stemp | 5 Galvanic Stock + 6 Refined Ferrite + 2 Power Cell | 20 | 280 |

#### Countertop Cooker

- **Client:** Greta Voss — *background resident*, already established via
  Cracked Heater Housing above.
- **Item:** her old induction-style countertop cooker, split at its
  conductive support ring.
- **New Work Order canon:** Greta owns a countertop cooker in addition to her
  established room heater. Nothing else — no new occupation, home, or family.
- **Why the pairing works:** a second ordinary Power-Cell appliance failing is
  exactly her established register — domestic need, not a trade.

#### Powered Souvenir Display

- **Client:** Bix Weller — *established NPC*.
- **Item:** one of Holo Hollow Souvenirs' old rotating, lighted tourism-era
  displays, with a failed conductive rail.
- **New Work Order canon:** the shop has an old powered display fixture in
  addition to the established shelving. Bix keeps it running rather than
  replacing it.
- **Why the pairing works:** it is the same "tourism-era fixtures outliving
  their purpose" characterization as the Sagging Shelf Bay, applied to a
  second object rather than restated on the same one.

#### FurBaby™ Repair

- **Client:** Tansy Rusk — *established NPC*.
- **Item:** her **FurBaby™** animatronic companion toy, which she has had
  since she was little — a failing conductive rail and a burned-out Cell
  socket.
- **New Work Order canon:** Tansy owns and has long owned a FurBaby™ toy.
  **Protected canon — do not violate:** it is approved and safe to say she has
  had it since childhood; it is **not** approved to reveal or imply that her
  parents gave it to her. Her parents and that history remain internal,
  unshipped canon for a later authored reveal (`docs/npc-canon.md`, Tansy
  Rusk).
- **Why the pairing works:** a mechanic who builds her own equipment from
  mismatched salvage keeping a childhood object running the same way is
  consistent with her established engineering style, without touching the
  protected family history that object could otherwise imply.

#### Helmet Charging Rack

- **Client:** Renn Calder — *established NPC*.
- **Item:** the charging rack for his mining helmet, lamp, and comms gear —
  a cracked power rail, with the rest of the rack still sound.
- **New Work Order canon:** Renn owns a charging rack for his own gear, in
  addition to his established carry frame. Ordinary miner equipment; nothing
  else is implied about a home, vehicle, or business.
- **Why the pairing works:** the same unglamorous, understated register as
  the Split Carry Frame — plain kit a working miner would own and use daily.

#### Portable Cargo Scale

- **Client:** Otis Mott — *background resident*, already established via
  Electric Cargo Dolly above.
- **Item:** his portable freight/cargo scale — a bent platform frame and a
  damaged load-sensing rail.
- **New Work Order canon:** Otis owns a cargo scale in addition to his
  established electric dolly. Refined Ferrite repairs the bent frame;
  Galvanic Stock repairs the sensing/conductive hardware — a mechanical split,
  not an arbitrary one.
- **Why the pairing works:** a hauler plausibly owns more than one piece of
  cargo-handling equipment, and this job needs no new biography to justify it.

#### B&B Linen Press

- **Client:** Mara Kells — *established NPC*.
- **Item:** HH B&B's old commercial linen press — a warped heated-platen
  support and a conductive rail separating from the frame.
- **New Work Order canon:** the B&B has a commercial linen press in addition
  to its established bed frames. Refined Ferrite handles the platen support;
  Galvanic Stock handles the conductive rail.
- **Why the pairing works:** it quietly deepens the B&B as a working inn
  (laundry infrastructure, not just rooms) exactly the way the Tourist-Era Bed
  Frame already does.

#### Powered Cable Puller

- **Client:** Pell Larkin — *background resident*, already established via
  Binding Hand Winch above.
- **Item:** his mining-crew powered cable puller — damage to its mounting
  frame, its current rail, and its powered assembly.
- **New Work Order canon:** Pell owns a *second*, powered piece of crew
  equipment in addition to his established manual hand winch. The contrast
  (manual vs. powered) is deliberate and is the entire characterization this
  job adds — nothing else about Pell is expanded.
- **Why the pairing works:** a mining crew plausibly has both manual and
  powered gear, and pairing the two jobs for one person makes that contrast
  legible without inventing a new person.

#### Speeder Power Cradle

- **Client:** Juno Stemp — *background resident*, already established via
  Speeder Cargo Rack above.
- **Item:** her speeder's frame and the conductive bus around its drive and
  Cell cradle — twisted and damaged by a hard landing.
- **New Work Order canon:** the same established speeder from Speeder Cargo
  Rack, now with drive/Cell-cradle damage instead of cargo-rack damage. **20
  sections**, the longest job in either pool, because she runs deliveries and
  cannot be down long — urgency expressed through scale, not through new
  dialogue or a portrait. Juno remains a background client with no authored
  dialogue, map presence, or portrait.
- **Why the pairing works:** it is the same established vehicle failing in a
  different, plausible way, which is exactly what "a real local repair
  business has repeat customers" means in practice.

## Background residents introduced by this pool

| Name | Pronouns | Occupation | The one possession the job needs |
| --- | --- | --- | --- |
| Otis Mott | he/him | Hauler | An electric cargo dolly |
| Pell Larkin | he/him | Works a mining crew | A hand winch |
| Juno Stemp | she/her | Runs local deliveries | A speeder with a cargo rack |
| Greta Voss | she/her | *None established* | A Power-Cell room heater |

That table is the **complete current** canon for these four people. Nothing
beyond the facts listed may be assumed, and it is not a placeholder for an agent
to fill in while writing something else — if a job or a line seems to need more,
it does not get invented here. None of them is on the NPC roster, and none gets a
portrait, dialogue, map presence, or Wiki page
(`docs/npc-canon.md`, "Background Work Order clients are not roster NPCs").

Each of these four now has **two** authored jobs (the Refining-5+ pool reuses
every client from the original eight; see above). Receiving a second job does
**not** promote any of them off this table or onto the interactable NPC
roster — the same "background residents are allowed to simply exist" rule
applies regardless of how many jobs a client has.

They stay background residents unless somebody deliberately promotes one. Later
authored content **may** establish new facts about them — that is a deliberate
content decision, made on purpose and recorded, and it is the only way this table
grows.

## Selection and refill

`selectWorkOrderRefill` (`game/domain/work-orders.ts`) is the one selection
rule, used both to draw the initial three-slot board and to refill a slot that
just finished:

- Two exclusions apply, and they are by **job identity**, never client
  identity: a job already visible elsewhere on the board can never be drawn,
  and the job just completed is preferred against, but not absolutely excluded.
- **Never duplicating a visible posting wins outright.** If excluding the
  visible jobs leaves nothing eligible, the slot is simply left unfilled rather
  than posting a duplicate.
- **The just-cleared exclusion is the one that relaxes.** If excluding both the
  visible jobs and the job just completed would leave nothing, the just-cleared
  job becomes drawable again rather than leaving the slot empty. That
  precedence — never duplicate a visible posting, relax the just-completed
  exclusion first — cannot actually trigger against the current sixteen-job
  pool, because lower-level jobs stay eligible forever and the pool only
  grows.
- There is deliberately **no weighting, normalization, or per-client cap.** A
  client with more authored jobs simply appears more often on the board, which
  is the content saying they use Wade's shop more. Nothing compensates for one
  client having more eligible jobs than another.

> **Job identity must be distinct. Client identity does not have to be.**

A **different** Work Order from the same client is perfectly eligible, and two
of one person's jobs appearing among the three visible postings at once is
**not** a duplicate. So none of the following exist, by design:

- a rule that visible postings must come from different clients;
- a refill that avoids a client already on the board;
- a cap of one posting per client;
- weighting or normalizing selection by client;
- compensation for one client having more authored jobs than another.

**Every client in the current sixteen-job pool has two authored jobs** (#217
paired each Refining-5+ job with an existing client rather than introducing a
new one), so a board — or a refresh — showing the same person's two different
jobs at once is expected, not a bug. Nothing above needed to change when that
happened: job identity, never client identity, was always the rule.

## Runtime validation

`validateWorkOrderDefinitions` (`game/domain/work-orders.ts`) runs at module
load, beside the other content registries, and checks the authored pool
against every rule above so an authoring mistake fails at server startup
instead of reaching a player as a wrong payout or an unpayable recipe:

| Check | What it catches |
| --- | --- |
| Unique `id` | Two jobs cannot silently collide |
| Non-empty `title`, `clientName`, `description` | No blank board copy |
| Positive integer `requiredWeldingLevel` and `sections` | No zero-length or negative job |
| Positive integer `requiredRefiningLevel`, when authored | No zero or fractional Refining floor (#217) |
| At least one material, no item named twice, every item a known stackable | No unpayable or malformed recipe |
| `payoutCredits` equals `workOrderPayoutCredits(definition)` | A stored payout can never drift from the rule that derives it |
| Pool size `>= postedSlots + 1` (currently 4) | A board of 3 distinct postings plus one non-repeating refill is always possible |

Sixteen jobs against a minimum pool of four leaves twelve jobs of headroom, so
the selection rules never deadlock at the current pool size — comfortably true
even restricted to just the eight Welding-only or the eight Refining-5+ jobs
considered alone.

There is deliberately **no minimum section count** beyond one. The generalized
Clean Pass cadence supports zero opportunities below its own authored minimum
length (`docs/gameplay-foundations.md`), so a job shorter than that simply has
none — that is the cadence working as specified, not a malformed job. All
sixteen current jobs are 8 sections or longer, which is authoring taste rather
than a rule the validator enforces.
