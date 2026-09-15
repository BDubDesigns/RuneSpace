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

### 1. Cracked Cutter Housing

- **ID:** `tansy_cutter_housing`
- **Client:** Tansy Rusk — *established NPC*
- **Item:** the housing of her own salvage cutter
- **Length:** `short`
- **Terminal description:** One of the mismatched joints in Tansy Rusk's cutter
  housing has finally let go. She built the thing out of spares, and she is not
  walking off the seam mid-shift to fix it, so it comes to the bench.
- **Why it is hers:** The cutter is the single object canon ties to Tansy
  unambiguously. She built it "from spare parts and stubbornness", and says
  herself that nothing on it matches — a weld failing at a mismatched joint is
  the most consistent possible failure for it. She works The Jag, not a bench,
  and Keep the Change already established that she does not leave the seam
  mid-shift for a part she needs.
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
- **Why it is his:** His shop is the clearest case in town of fixtures outliving
  their purpose — tourism-era shelving built for shirts, mugs and projector toys,
  now carrying the mining supplies that are the only thing that sells. The repair
  *is* his characterization.
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
- **Why it is his:** He is established as a working ferrite miner, and a working
  miner's own kit is the reasonable floor of what he owns. The job is
  deliberately unglamorous and understated, which is his register.
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
- **Why it is hers:** She owns the inn, and her own account of it is that the
  rooms and their contents did not change when the clientele did — "same beds,
  fewer complaints about the pillows". A tourism-era bed frame failing under
  working crews is her whole business model in one object.
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
- **Why it is his:** Hauling is part of Holo Hollow's adapted economy, and the
  town's inn explicitly serves haulers. A dolly is the most ordinary possible
  possession for one.
- **New canon introduced:** Otis Mott is a local hauler and owns a cargo dolly.
  He/him. Nothing else.

### 6. Seized Hand Winch

- **ID:** `larkin_hand_winch`
- **Client:** Pell Larkin — *background resident*
- **Item:** a hand winch whose drum mount is bent, binding the cable under load
- **Length:** `long`
- **Terminal description:** The drum mount on Pell Larkin's hand winch is bent
  out of true, so the cable binds the moment there is any weight on it. It wants
  the mount cut back and re-laid straight.
- **Why it is his:** Mining crews are established in Holo Hollow, and a hand
  winch is ordinary worksite equipment a crew hand would own and use most days.
- **New canon introduced:** Pell Larkin works a mining crew and owns a hand
  winch. He/him. Nothing else.

### 7. Speeder Cargo Rack

- **ID:** `stemp_speeder_rack`
- **Client:** Juno Stemp — *background resident*
- **Item:** the cargo rack on her speeder, cracked at the frame mounts
- **Length:** `standard`
- **Terminal description:** The cargo rack on Juno Stemp's speeder has cracked at
  both frame mounts. She runs deliveries out of Holo Hollow, and the rack carries
  the entire load.
- **Why it is hers:** Gig and delivery work is part of the town's adapted economy,
  and speeders are already established in the world — Rusk Recovery's own yard has
  damaged ones waiting their turn, so a speeder fitting arriving for a weld needs
  no new worldbuilding.
- **New canon introduced:** Juno Stemp runs local deliveries and owns a speeder
  with a cargo rack. She/her. Nothing else. The speeder is deliberately
  unnamed and unmodelled.

### 8. Cracked Heater Housing

- **ID:** `voss_heater_housing`
- **Client:** Greta Voss — *background resident*
- **Item:** the housing of her room heater, cracked through at a seam
- **Length:** `short`
- **Terminal description:** The housing on Greta Voss's room heater has cracked
  through at a seam, and it will not hold a Power Cell safely until it is closed
  up again.
- **Why it is hers:** A Power-Cell heater is the most ordinary domestic object in
  Holo Hollow — the Annex's whole public purpose is keeping "heat, comms, or a
  tool alive". This job is the one on the board that is not about somebody's
  trade, which is deliberate: the shop serves the town, not only its workers.
- **New canon introduced:** Greta Voss is a resident of Holo Hollow and owns a
  Power-Cell room heater. She/her. Nothing else — no occupation, because the job
  does not need one.

## Background residents introduced by this pool

| Name | Pronouns | Occupation | The one possession the job needs |
| --- | --- | --- | --- |
| Otis Mott | he/him | Hauler | A cargo dolly |
| Pell Larkin | he/him | Works a mining crew | A hand winch |
| Juno Stemp | she/her | Runs local deliveries | A speeder with a cargo rack |
| Greta Voss | she/her | *None established* | A Power-Cell room heater |

That table is the **complete** canon for these four people. It is not a
placeholder to be filled in later. None of them is on the NPC roster, and none
gets a portrait, dialogue, map presence, or Wiki page
(`docs/npc-canon.md`, "Background Work Order clients are not roster NPCs").

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

One property worth keeping: **all eight clients are distinct**, so no board can
show the same person twice and nobody appears to have three broken things at
once. At this pool size that falls out of the content, so no client-level
distinctness rule needs building.

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
