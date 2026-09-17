# Work Orders — Board Rules and the Client Pool

## Status and scope

**Work Orders are implemented and playable** (issue #207, on the foundation
issue #190 laid down). The Work Orders terminal at Rusk Recovery becomes a
real surface — instead of scenery — once **10,000 Hours** is completed, and
becomes the player's own once **10,001 Hours** is **accepted**: a character
who has accepted it can browse the board, accept a posting, Start/Resume
Welding it, and get paid on completion. See "The unlock" below for why
acceptance, not turn-in, is the gate.

This document owns the **content and product** side: the settled board rules,
the rule for choosing a client, the authored pool of eight level-5 jobs, and
the payout and XP rules the pool is authored against. The runtime mechanics
Work Orders share with every other kind of Welding — the Clean Pass cadence,
the one-bench exclusivity rule, and the offline/Stop/Travel contract — are
recorded once in `docs/gameplay-foundations.md` and are not repeated here.

Implementation: `game/content/work-orders.ts` (the pool),
`game/domain/work-orders.ts` (payout, XP, selection, and the load-time
validation), `game/config/balance.ts` (`workOrders`, `welding.cleanPass`),
`server/work-orders.ts` (the durable board and its completion),
`server/work-order-commands.ts` (Accept/Start/Stop), and `db/rune-space.ts`
(`character_work_order_postings`).

Related: `docs/npc-canon.md` (internal character canon and the client-
eligibility rule), `docs/holo-hollow.md` (settlement, economy, tone),
`docs/missions.md` (the Mission framework, which Work Orders are **not**),
`docs/gameplay-foundations.md` (Clean Pass, Workbench exclusivity, and the
shared offline/Stop/Travel contract Work Orders reuse rather than reimplement).

## Shipped board rules

- **Exactly 8 authored level-5 jobs** in the pool today (`WORK_ORDERS` in
  `game/content/work-orders.ts`).
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
- No real-time rotation, daily reset, cooldown, or manual refresh: a slot's job
  changes only when that slot's job is completed.
- A refill never duplicates another currently posted job, and never
  immediately redraws the job just completed while another eligible option
  exists (`selectWorkOrderRefill`; see "Selection and refill" below).
- Welding level expands the eligible pool later; **lower-level jobs stay
  eligible forever** (`eligibleWorkOrders` filters by `>=`, never by exact
  tier).
- Low-level jobs use **Refined Ferrite** as their base repair material; two of
  the eight (Tansy's and Otis's) also require **Power Cell**, because their
  fiction is that a Cell was physically destroyed, not because higher-level
  jobs have arrived yet. Every job in the pool is level 5 today, so the pool's
  own gate and the board's minimum Welding level
  (`workOrders.requiredWeldingLevel`, also 5) coincide until a higher-level
  job is authored.
- Real Work Orders use genuine Welding and pay **40% of the global Welding
  XP per section** — double Practice's share, well under an authored story
  repair's full rate. See "Welding XP" below.
- Payout exceeds the direct-sale value of the material a job consumes by a
  fixed labor premium, and every authored payout is validated against the rule
  that produces it. See "The payout rule" below.

### Completion is a transaction, not a scene

> **Repeatable Work Orders are shop jobs, not miniature Missions. Their
> completion does not carry bespoke client dialogue.**

None of the eight jobs authors a completion scene. Completion is a database
transaction (`completeActiveWorkOrder`): it pays the Credits, credits the
Mission's generic `work_order` tracked-activity counter, and refills the slot,
all under the guard of the same update that claims the completion — so a retry
or a completion discovered by lazy reconciliation while the player was away
pays exactly once. The client-facing acknowledgement is one generic line
("*\<title\>* is finished and paid — *N* Credits."), the same shape for every
job in the pool; a finished bracket does not summon its client for a
conversation.

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
sells it) and **Power Cell at 8 Credits** (Bix sells it at 8, which outranks
his 3-Credit buy-back). A merchant price change moves this value automatically
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

## The pool — eight level-5 Work Orders

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
| Cracked Cutter Housing (`tansy_cutter_housing`) | Tansy Rusk | 4 Refined Ferrite + 1 Power Cell | 12 | 115 |
| Tourist-Era Bed Frame (`mara_bed_frame`) | Mara Kells | 5 Refined Ferrite | 13 | 120 |
| Speeder Cargo Rack (`stemp_speeder_rack`) | Juno Stemp | 6 Refined Ferrite | 14 | 135 |
| Binding Hand Winch (`larkin_hand_winch`) | Pell Larkin | 4 Refined Ferrite | 16 | 120 |
| Electric Cargo Dolly (`mott_cargo_dolly`) | Otis Mott | 8 Refined Ferrite + 3 Power Cell | 19 | 200 |

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

Jobs were authored against three rough sizes: **short** (2-4 Refined Ferrite),
**medium** (3-6), and **long** (4-8). These ranges are recorded here as
guidance for whoever authors the ninth job, so a new job lands in a size the
pool doesn't already have plenty of — they are **not** stored anywhere in the
runtime pool. Nothing in `WorkOrderDefinition` carries a size label; a job's
scale is expressed purely through its `materials` and `sections`, and the
ranges above may be revised or ignored entirely once a real ninth job proves
what the next size needs.

### 1. Cracked Cutter Housing

- **ID:** `tansy_cutter_housing`
- **Client:** Tansy Rusk — *established NPC*
- **Item:** the housing of her own working cutter, including the Cell it
  carried
- **Materials:** 4 Refined Ferrite + 1 Power Cell · **Sections:** 12 ·
  **Payout:** 115 Credits
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
  **Payout:** 200 Credits
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
  exclusion first — cannot actually trigger against the current eight-job pool,
  because lower-level jobs stay eligible forever and the pool only grows.
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

**All eight clients in the current pool happen to be distinct**, so no board
drawn from *this* pool can show the same person twice today. That is an
incidental property of the current eight, **not a board rule**, and adding a
second job for an existing client would not need any of the above to change.

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
| At least one material, no item named twice, every item a known stackable | No unpayable or malformed recipe |
| `payoutCredits` equals `workOrderPayoutCredits(definition)` | A stored payout can never drift from the rule that derives it |
| Pool size `>= postedSlots + 1` (currently 4) | A board of 3 distinct postings plus one non-repeating refill is always possible |

Eight jobs against a minimum pool of four leaves four jobs of headroom, so the
selection rules never deadlock at the current pool size.

There is deliberately **no minimum section count** beyond one. The generalized
Clean Pass cadence supports zero opportunities below its own authored minimum
length (`docs/gameplay-foundations.md`), so a job shorter than that simply has
none — that is the cadence working as specified, not a malformed job. All eight
current jobs are 8 sections or longer, which is authoring taste rather than a
rule the validator enforces.
