# Work Orders — Board Rules and the Initial Client Pool

## Status and scope

This document is the approved **content and product** foundation for Work
Orders: the settled board rules, the rules for choosing a client, and the first
authored pool of eight level-5 jobs.

**Work Orders are not implemented.** Nothing here describes shipped behavior.
The Work Orders terminal exists at Rusk Recovery and is revealed by completing
**10,000 Hours**, and it is deliberately empty: it states the Welding level real
client work will need and offers nothing (`game/content/rusk-recovery.ts`,
`game/config/balance.ts` `workOrders.requiredWeldingLevel`,
`features/practice/WorkOrdersTerminal.tsx`).

This document exists so that a later focused implementation issue does not have
to invent the feature and its fiction at the same time. That issue owns
persistence, schema, commands, selection, payouts, material consumption, UI, and
server logic. **None of those are decided here**, including whether a job
persists through a repair-target row, a dedicated table, or something else.

Related: `docs/npc-canon.md` (internal character canon and the client-eligibility
rule), `docs/holo-hollow.md` (settlement, economy, tone), `docs/missions.md`
(the Mission framework, which Work Orders are **not**).

## Settled product rules

These are settled and should be treated as requirements by the implementation
issue.

- Exactly **8 authored level-5 jobs** in the initial eligible pool.
- Exactly **3 distinct posted jobs** visible at once.
- **One persistent active Work Order** per character.
- Accepting a job leaves that posting visible, marked **In Progress**.
- Successful completion **immediately refills that slot** from the eligible pool.
- **Abandoning** an active Work Order also immediately replaces that posting,
  once the abandoned job and its state have cleared.
- Completion and abandonment use the **same** distinct/anti-repeat rules.
- No real-time rotation, daily reset, cooldown, or manual refresh.
- A replacement must not duplicate another currently posted job.
- Do not immediately redraw the job just completed or abandoned when another
  eligible option exists.
- Welding level expands the eligible pool later; **lower-level jobs stay
  eligible forever**.
- Low-level jobs use **Refined Ferrite** as the player-supplied repair material.
  Higher-level jobs will use higher-level materials later.
- Real Work Orders use genuine Welding and **full** Welding XP — not Practice's
  reduced share.
- Payout must exceed the direct-sale value of the consumed player material by an
  appropriate labor premium.
- Exact section counts, material quantities, and payouts are **balance-sensitive
  and remain provisional** pending Practice playtesting and economy evidence.

### Completion is a transaction, not a scene

> **Repeatable Work Orders are shop jobs, not miniature Missions. Their normal
> completion does not require bespoke client dialogue.**

None of the eight jobs below authors a completion scene, and none should. A
finished Work Order should eventually give a clear, **generic** transactional
acknowledgement of the result — the repair is done, the Welding XP earned, the
Credits paid, and whatever material or result state applies. One acknowledgement
serves every job in the pool.

The exact copy and UI belong to the implementation issue; nothing here
prescribes them, and nothing here is implemented. What is settled is the
product rule: a client does not appear and talk to the player because a bracket
got welded.

A later special contract may deliberately carry authored dialogue or a narrative
completion beat, but that is outside this system and has to be earned by a
specific content need rather than assumed as the default shape.

## Choosing a client

> **Work Order clients do not need to have been met, and do not need to be
> interactable NPCs.** A named client may be an established NPC or a background
> resident introduced through authored job fiction. Player encounter chronology
> does not determine whether that person can use Rusk Recovery.

Holo Hollow exists independently of the order the player walks through it. A
resident's dolly is buckled whether or not the player has met them, and a real
local repair business has customers the player has not been introduced to. A
player recognising a name from the board and meeting that person later is a
feature, not a leak.

**Eligible established NPCs:** Tansy Rusk, Bix Weller, Renn Calder, Mara Kells.

**Wade Rusk is excluded from the initial pool.** This is a framing decision, not
a chronology one: he owns the yard, the bench, and the terminal the paying work
arrives through, so making him one of the first customers would blur *Wade
assigning work around his own shop* with *customers bringing paying work in*.
Direct apprentice or shop work from Wade remains available to later content.

Rules that hold for every job:

- Use an established NPC **only** where the item genuinely reinforces their
  established work, business, equipment, or circumstances. Do not force one job
  per NPC to be tidy, and do not stack several onto one to hit a ratio.
- Prefer a **named** background resident over a label like "a local miner" when a
  real customer would plausibly be attached to the repair.
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

## The initial pool — eight level-5 Work Orders

Common to all eight, and therefore not repeated per job:

- **Minimum Welding level:** 5.
- **Repair material family:** Refined Ferrite. **Quantity: TBD** (balance).
- **Payout:** **TBD** (economy). Must exceed the direct-sale value of the
  Refined Ferrite consumed — Bix currently buys it at 10 Credits — by a labor
  premium.
- **Welding length:** a provisional category only (`short` / `standard` /
  `long`). **Exact section counts: TBD** pending Practice playtesting.
- **Progression prerequisite:** none beyond the board's own gate (10,000 Hours
  complete, Welding level 5). No job below needs a prerequisite of its own,
  which means **no per-job gating mechanism has to be built**.

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

### `short` / `standard` / `long` are authoring guidance only

The length category on each job is **planning intent for authors**, recorded so
the eight jobs are not accidentally all the same size before playtesting says
what a size is.

It is explicitly **not** a runtime concept. It requires no enum, no schema
property, no database field, and no persisted category. The implementation may
express job length purely through tuned Welding section counts, or through
whatever concrete balance values are approved after Practice playtesting. If the
labels turn out to be redundant once real counts exist, they may stay docs-only
or disappear entirely.

A planning adjective must not become a mandatory implementation abstraction.

### 1. Cracked Cutter Housing

- **ID:** `tansy_cutter_housing`
- **Client:** Tansy Rusk — *established NPC*
- **Item:** the housing of her own salvage cutter
- **Length:** `short`
- **Terminal description:** One of the mismatched joints in Tansy Rusk's cutter
  housing has finally let go. She built the thing out of spares, and she is not
  walking off the seam mid-shift to fix it, so it comes to the bench.
- **Established canon:** Tansy is a field mechanic and miner who works The Jag,
  and she builds functional equipment out of mismatched salvage and spares — she
  says of the cutter she made that nothing on it matches and that she threw it
  together from parts she had lying around. Keep the Change established that she
  does not leave the seam mid-shift for a part she needs.
- **New Work Order canon:** Tansy owns and uses a **separate working cutter**,
  whose housing is built with the same practical mismatched-spares approach as
  her established engineering style. That is the whole expansion.
- **Why the pairing works:** her established engineering style predicts exactly
  this failure — a weld letting go at a joint between two parts that were never
  meant to meet — and her established working life explains why it reaches
  Wade's bench instead of her own hands.
- **Provenance caution:** the Salvage Cutter in shipped dialogue is the one Tansy
  **builds and gives to the player**. It is not this cutter, and shipped content
  does not establish that she keeps a second one. Do not cite the player's
  Cutter as evidence that this one already existed.
- **Canon notes:** `game/content/dialogue.ts` (`tansyCompletion`,
  `tansyAfterRemoteAcceptance`, `tansyMiningTopic`), `game/content/npcs.ts`,
  `docs/npc-canon.md` (Tansy → Work, business, and equipment context).

### 2. Sagging Shelf Bay

- **ID:** `bix_shop_shelving`
- **Client:** Bix Weller — *established NPC*
- **Item:** a shelf bay and its brackets in Holo Hollow Souvenirs + Mining Supplies
- **Length:** `standard`
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
- **Length:** `short`
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
- **Length:** `standard`
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

### 5. Cargo Dolly Bed

- **ID:** `mott_cargo_dolly`
- **Client:** Otis Mott — *background resident*
- **Item:** the bed frame of his cargo dolly, buckled out of true
- **Length:** `standard`
- **Terminal description:** The bed frame on Otis Mott's cargo dolly is buckled
  and the load will not sit square on it any more. He hauls freight around the
  valley and cannot work without it.
- **Established canon:** hauling is part of Holo Hollow's adapted economy, and
  the town's inn explicitly serves haulers. The occupation exists; this person
  does not yet.
- **New Work Order canon:** Otis Mott is a local hauler and owns a cargo dolly.
  He/him. Nothing else.
- **Why the pairing works:** a dolly is the most ordinary possible possession for
  somebody who moves freight for a living.

### 6. Binding Hand Winch

- **ID:** `larkin_hand_winch`
- **Client:** Pell Larkin — *background resident*
- **Item:** a hand winch whose drum mount is bent, binding the cable under load
- **Length:** `long`
- **Terminal description:** The drum mount on Pell Larkin's hand winch is bent
  out of true, so the cable binds the moment there is any weight on it. It wants
  the mount cut back and re-laid straight.
- **Established canon:** mining crews are established in Holo Hollow, and they
  work a haul road and a shift. The crews exist; this person does not yet.
- **New Work Order canon:** Pell Larkin works a mining crew and owns a hand
  winch. He/him. Nothing else.
- **Why the pairing works:** a hand winch is ordinary worksite equipment a crew
  hand would own and use most days, and a bent drum mount is a wear failure
  rather than a dramatic one.

### 7. Speeder Cargo Rack

- **ID:** `stemp_speeder_rack`
- **Client:** Juno Stemp — *background resident*
- **Item:** the cargo rack on her speeder, cracked at the frame mounts
- **Length:** `standard`
- **Terminal description:** The cargo rack on Juno Stemp's speeder has cracked at
  both frame mounts. She runs deliveries out of Holo Hollow, and the rack carries
  the entire load.
- **Established canon:** gig and delivery work is part of the town's adapted
  economy, and speeders already exist in the world — Rusk Recovery's own yard has
  damaged ones waiting their turn. The occupation and the vehicle class exist;
  this person and her speeder do not yet.
- **New Work Order canon:** Juno Stemp runs local deliveries and owns a speeder
  with a cargo rack. She/her. Nothing else. The speeder stays deliberately
  unnamed and unmodelled.
- **Why the pairing works:** a rack that carries the whole load is the part of a
  delivery runner's kit that fails first, and it needs no new worldbuilding.

### 8. Cracked Heater Housing

- **ID:** `voss_heater_housing`
- **Client:** Greta Voss — *background resident*
- **Item:** the housing of her room heater, cracked through at a seam
- **Length:** `short`
- **Terminal description:** The housing on Greta Voss's room heater has cracked
  through at a seam, and it will not hold a Power Cell safely until it is closed
  up again.
- **Established canon:** the Annex's whole public purpose is keeping "heat,
  comms, or a tool alive", so Power-Cell heating is established as an ordinary
  domestic need out here. This person does not yet exist.
- **New Work Order canon:** Greta Voss is a resident of Holo Hollow and owns a
  Power-Cell room heater. She/her. Nothing else — **no occupation**, because the
  job does not need one.
- **Why the pairing works:** this is the one job on the board that is not about
  somebody's trade, which is deliberate: the shop serves the town, not only its
  workers.

## Background residents introduced by this pool

| Name | Pronouns | Occupation | The one possession the job needs |
| --- | --- | --- | --- |
| Otis Mott | he/him | Hauler | A cargo dolly |
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

## Phase 8 — pool and anti-repeat validation

Content-level validation against the settled runtime rules. **The selection
algorithm is not implemented here**; this only shows the authored pool can
satisfy the rules.

| Rule | Result |
| --- | --- |
| A board can show 3 distinct jobs | ✅ 8 eligible jobs, all level 5 from the start |
| A refill avoids duplicating either other visible posting | ✅ worst case excludes 2 |
| A refill avoids immediately redrawing the just-cleared job | ✅ excludes 1 more |
| Enough pool for both rules at once | ✅ 3 excluded leaves **5** candidates |
| Same rules for completion and abandonment | ✅ nothing in the content distinguishes them |
| No procedural text generation | ✅ all 8 fully authored |
| No damaged-item inventory object required | ✅ every job is abstract bench work |
| Repeats stay believable | ✅ all 8 are archetypes a real shop sees again |

**Minimum viable pool size is 4** — three exclusions plus one drawable job. Eight
leaves four jobs of headroom, so the rules never deadlock at this level.

**All eight clients happen to be distinct**, so no board drawn from *this* pool
can show the same person twice. That is an incidental property of the initial
authored eight, **not a board rule, and not something the implementation must
enforce.**

> **Job identity must be distinct. Client identity does not have to be.**

The anti-repeat rules are job-based and stay that way: the same Work Order cannot
occupy two visible slots, and the just-completed or just-abandoned Work Order
should not immediately redraw while another eligible job exists. A **different**
Work Order from the same client remains perfectly eligible, and two of one
person's jobs appearing among the three visible postings at once is **not** a
duplicate.

So do not build any of the following:

- a rule that visible postings must come from different clients;
- a refill that avoids a client already on the board;
- a cap of one posting per client;
- weighting or normalizing selection by client;
- compensation for one client having more authored jobs than another.

Client imbalance is meaningful authored content rather than a distribution bug.
If Bix eventually has four eligible repair jobs and another resident has one,
that says Bix uses Wade's shop more often, and he should appear on the board more
often as a result. Unless a future design explicitly adds weighting, **each
eligible authored Work Order participates as its own job.**

**Edge case to record for implementation.** If a future eligible pool is ever
smaller than 4, the two exclusions conflict. The precedence should be: never
duplicate a currently visible posting, and relax the just-cleared exclusion
first. That situation cannot arise from this pool, because lower-level jobs stay
eligible forever and the pool only grows.

## Handoff to the implementation issue

Provided here: the eight jobs, their clients, stable IDs, the fiction, the client
rules, and this validation.

Deliberately **not** decided here, and to be settled against then-current `main`
by a fresh read-only checkpoint:

- persistence shape — repair-target rows, a dedicated Work Order table, or
  something else;
- the selection/refill implementation and where it runs;
- acceptance, completion, and abandonment commands and their transactions;
- the terminal's UI and how a posting presents In Progress;
- exact Refined Ferrite quantities, section counts, and Credit payouts, which
  stay provisional until Practice playtesting and economy evidence exist;
- whether Welding XP for a real Work Order needs anything beyond the ordinary
  full-rate Welding path.
