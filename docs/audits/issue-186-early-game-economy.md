# Issue #186 — early-game Credit economy audit and Work Order payout guardrails

Durable evidence record for Issue #186. It measures the **shipped** early-game
economy and produces a parametric model for a later Work Order balance decision.

**Nothing in this audit changes gameplay, balance, persistence, or schema.** No
merchant price, success rate, yield, duration, recipe, allotment, fare, capacity,
Mission grant, or `docs/work-orders.md` TBD was touched. Every recommendation at
the end is a **proposal requiring separate product-owner approval**.

## 1. Method and provenance

| Item | Value |
| --- | --- |
| Audited revision | `1c44bd950e29f0d40f6093b268a7f5aa257bf7ad` (`main`, 2026-09-16) |
| Reproduction | `node --experimental-strip-types scripts/economy-audit-186.mjs --trials 20000` |
| Trials behind each RNG figure | 20,000, seeded and deterministic |
| Tick | `GAME_TICK_MS = 600` ms (`game/config/foundations.ts:4`) |

Every number below comes from the current implementation, not from prose. Where
an outcome depends on RNG, capacity, or stack fragmentation, the figure was
produced by driving the **authoritative resolver** —
`resolveFerriteShaleMining`, `resolveRefining`, `resolvePracticeWelding` — rather
than by re-deriving the rule. Only arithmetic the resolvers do not own (walking
path lengths from the authored adjacency, merchant totals, Clean Pass time
savings) is computed in the script.

Figures are reported separately for **repeatable income**, **one-time
injections**, **direct Credit sinks**, **material opportunity cost**, and
**free/limited resources**, and are never averaged across unlock states.

## 2. Facts — authoritative inputs

### 2.1 Merchants

Prices are flat per item per direction; there is no multiplier, level scaling,
bulk curve, merchant wallet, or finite stock (`game/domain/trade.ts:32-99`,
`game/content/merchants.ts:13-41`).

| Item | Bix pays player | Player pays Bix | Player pays Wade |
| --- | --- | --- | --- |
| Ferrite Shale | 2 | — | — |
| Refined Ferrite | 10 | — | — |
| Slag | 1 | — | — |
| Power Cell | 3 | 8 | — |
| Scrap Metal | — | — | 2 |

Bix Weller trades at the `holo_hollow_souvenirs` Local Place inside **Holo
Hollow**, open to any character (`game/content/local-places.ts:26-32`). Wade Rusk
trades at the **Rusk Recovery** World Location, gated on `10,000 Hours` being
**accepted** (`game/content/merchants.ts:33-40`, `server/trade.ts:164-169`).

### 2.2 Action rules

| Rule | Value | Source |
| --- | --- | --- |
| Mining attempt | 10 ticks = 6.0 s | `game/config/balance.ts` `mining.attemptDurationTicks` |
| Mining success | `min(10000, 3500 + floor((min(L,30)-1) × 6500 / 29))` bps | `game/domain/mining.ts:39-49` |
| Mining yield | 1 or 2 Shale at 50/50 on success | `game/domain/mining.ts:216` |
| Mining XP | 15 per success only | `balance.mining.successXp` |
| Refining attempt | 7 ticks = 4.2 s, consumes 2 Shale **whether or not it succeeds** | `game/domain/refining.ts` |
| Refining success | `min(10000, 4000 + floor((min(L,20)-1) × 6000 / 19))` bps | `game/domain/refining.ts:47-58` |
| Refining output | 1 Refined Ferrite on success, 1 Slag on failure | `game/domain/refining.ts:26-45` |
| Refining XP | 15 success / 3 failure | `balance.refining` |
| Welding section | 5 ticks = 3.0 s | `balance.welding.attemptDurationTicks` |
| Welding XP | 50 per increment (full); Practice pays 20% = 10 | `balance.welding.xpPerIncrement`, `practiceSectionXp()` |
| Walk leg | 40 ticks = 24 s, identical on every edge | `balance.travel.adjacentWalkDurationTicks` |
| Crew Hauler | 20 ticks = 12 s, 5 Credits, **one-way** Holo Hollow → The Jag | `game/content/transport-routes.ts:66-77` |

**Refining reaches guaranteed success at level 20**, after which Slag stops
being produced by Refining at all. Mining reaches guaranteed success at level 30.

### 2.3 Capacity

Capacity is **slot-dominant**. Mass never binds for any early-game item.

| Fact | Value |
| --- | --- |
| Carry mass ceiling | 50,000 g, fixed — containers add slots, not mass (`game/domain/equipment.ts:172`) |
| Starter container | one Mykea Schleppraum 8, 8 slots, 10,000 g |
| Second container suit slot | exists but is never filled by provisioning (`server/play.ts:619-648`) |
| Mass free with container + Cutter equipped | 35,000 g |
| Max carried Ferrite Shale | **80** (8 slots × stack 10), using 8,000 g of 35,000 g |

### 2.4 Skill reachability

Times are pure action time at that skill's own level, ignoring travel and
capacity stops. Both skills use the same curve (500 XP to level 2, ×1.1 per
level, floored).

| Level | Total XP | Mining hours at that level's rate | Refining hours at that level's rate |
| --- | --- | --- | --- |
| 5 | 2,320 | 0.6 h | 0.3 h |
| 10 | 6,780 | 1.4 h | 0.7 h |
| 15 | 13,950 | 2.3 h | 1.2 h |
| 20 | 25,484 | 3.6 h | 2.0 h |
| 25 | 44,045 | 5.5 h | — |
| 30 | 73,925 | 8.2 h | — |

Mining 30 is a **long-horizon** state, not an early-game one: reaching it costs
on the order of 8 hours of pure mining even at the terminal rate, and far more
from below. Mining 20-25 is the realistic ceiling for the window this audit
covers.

## 3. Mining throughput

Measured by running the real resolver to its capacity stop on a full 8-slot load.

| Mining level | Success chance | Shale mined | Mining seconds | Shale/min | Gross Credits |
| --- | --- | --- | --- | --- | --- |
| 1 | 35.0% | 80 | 919.1 | 5.2 | 160 |
| 3 | 39.5% | 80 | 814.9 | 5.9 | 160 |
| 5 | 44.0% | 80 | 731.7 | 6.6 | 160 |
| 10 | 55.2% | 80 | 582.5 | 8.2 | 160 |
| 15 | 66.4% | 80 | 484.2 | 9.9 | 160 |
| 20 | 77.6% | 80 | 414.3 | 11.6 | 160 |
| 25 | 88.8% | 80 | 361.9 | 13.3 | 160 |
| 30 | 100.0% | 80 | 321.3 | 14.9 | 160 |

Practical constraints that materially change the theoretical rate:

- **Slots, not time, end a run.** A run stops with
  `inventory_slots_full`; the theoretical infinite-capacity rate never occurs.
  Time to fill the load falls from ~15.3 min at Mining 1 to ~5.4 min at Mining 30
  — a 2.86× spread, exactly the success-chance spread.
- **A partial yield is never lost.** If a 2-unit roll will not fit but a 1-unit
  roll will, the resolver downgrades the award rather than dropping it
  (`game/domain/mining.ts:229-240`).
- **Mining is offline-resolvable** up to a 1-hour cap
  (`STANDARD_OFFLINE_RESOLUTION_CAP_MS`), but the 80-Shale capacity stop always
  binds first, so the cap is not economically active today.
- **The Cutter is required, charge is not.** Zero charge mines at normal speed;
  only a missing Cutter blocks mining.

## 4. Raw Shale selling

A full load is always worth **160 Credits** (80 × 2). What differs is the loop
time. Bix is two walking legs from The Jag (The Jag → The Long Scramble → Holo
Hollow); entering his Local Place costs no time.

| Mining level | Walk both ways (Cr/h) | Walk + Scavenge (Cr/h) | Ride out, walk back (Cr/h) | Ride + Scavenge (Cr/h) |
| --- | --- | --- | --- | --- |
| 1 | 567 | 598 | 570 | 586 |
| 3 | 632 | 667 | 638 | 656 |
| 5 | 696 | 734 | 705 | 725 |
| 10 | 849 | 895 | 869 | 893 |
| 15 | 993 | 1,047 | 1,025 | 1,054 |
| 20 | 1,129 | 1,190 | 1,176 | 1,210 |
| 25 | 1,258 | 1,327 | 1,322 | 1,360 |
| 30 | 1,380 | 1,456 | 1,463 | 1,505 |

Routes modelled honestly against their unlock state:

- **Walk both ways** is the only route available until `Out of the Weather` —
  an **optional** Mission — is complete. Two legs each way, 96 s of travel per
  loop, two Scavenge opportunities.
- **Ride out, walk back** is the correct shape of the one-way Crew Hauler: the
  authored route runs Holo Hollow → The Jag, so it is the *outbound* leg of a
  sell loop and the *return to the merchant* is always the walk. Travel falls to
  60 s and costs 5 Credits, and the ride leg offers **no Scavenge**.

**The Crew Hauler is close to economically neutral.** It saves 36 s and costs 5
Credits plus one forgone Scavenge opportunity worth ~4.38 Credits in expectation
— roughly 9.4 Credits of value for 36 seconds. That only pays at high Mining
level: at Mining 1 the ride is worth +3 Cr/h, at Mining 30 it is worth +83 Cr/h.
Including Scavenge, riding is **worse** than walking below about Mining 15.

> Note: `game/domain/travel.ts:53-57` describes the route with a bidirectional
> arrow (`<->`) in prose. The route table authors exactly one direction and
> `getTransportRoute` does an exact-direction lookup, so the behaviour is
> strictly one-way. This is a comment-wording inconsistency only, not a defect.

## 5. Refining economics

### 5.1 A carried load cannot simply be refined

Refining requires that **both** of its mutually exclusive outputs can be placed
before it will roll (`refiningPreflightStopReason`, using
`planPossibleAwardAdditions`). Measured against the real resolver:

| Shale carried | Stacks | Free slots | Shale actually refined | Refining seconds |
| --- | --- | --- | --- | --- |
| 10 | 1 | 7 | 10 | 21 |
| 20 | 2 | 6 | 20 | 42 |
| 30 | 3 | 5 | 30 | 63 |
| 40 | 4 | 4 | 40 | 84 |
| 50 | 5 | 3 | 50 | 105 |
| 60 | 6 | 2 | **60** | 126 |
| 70 | 7 | 1 | **2** | 4.2 |
| 80 | 8 | 0 | **0** | 0 |

**This is the single most consequential undocumented constraint found.** A
player who mines a full 80-Shale load — the obvious thing to do — cannot refine
any of it. At 70 Shale they get exactly one attempt and then stall. The largest
carried load that refines to exhaustion is **60 Shale**, so a refine-first trip
mines 25% less per trip than a raw-sell trip.

### 5.2 Value per unit of Shale

Refining a 60-Shale load (the largest that fully refines):

| Refining level | Success chance | Refined Ferrite | Slag | Refining seconds | Credits if refined | Credits if sold raw | Uplift | Credits per 2 Shale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 40.0% | 12.0 | 18.0 | 126 | 138.0 | 120 | +15.0% | 4.60 |
| 3 | 46.3% | 13.9 | 16.1 | 126 | 155.0 | 120 | +29.2% | 5.17 |
| 5 | 52.6% | 15.8 | 14.2 | 126 | 172.1 | 120 | +43.4% | 5.74 |
| 10 | 68.4% | 20.5 | 9.5 | 126 | 214.7 | 120 | +78.9% | 7.16 |
| 15 | 84.2% | 25.3 | 4.7 | 126 | 257.3 | 120 | +114.4% | 8.58 |
| 20 | 100.0% | 30.0 | 0.0 | 126 | 300.0 | 120 | +150.0% | 10.00 |

On **value alone**, refining is never a loss: 2 Shale sold raw is 4 Credits, and
even the worst case (40% success) returns 4.60. The break-even success rate is
33.3%, which is below Refining's level-1 floor of 40%. At Refining 20 Slag
disappears entirely and every 2 Shale becomes a clean 10 Credits.

### 5.3 Value *and* time

The picture changes once the 25% smaller load, the 126 s of refining, and the
three extra walking legs (The Jag → Yard is 3 legs, Yard → Holo Hollow is 2) are
charged against it.

| Mining level | Raw sell (Cr/h) | R1 | R3 | R5 | R10 | R15 | R20 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 567 | 504 | 567 | 629 | 785 | 941 | 1,097 |
| 3 | 632 | 548 | 616 | 684 | 853 | 1,022 | 1,192 |
| 5 | 696 | 589 | 662 | 734 | 916 | 1,098 | 1,280 |
| 10 | 849 | 679 | 763 | 847 | 1,057 | 1,267 | 1,477 |
| 15 | 993 | 755 | 849 | 942 | 1,175 | 1,409 | 1,642 |
| 20 | 1,129 | 821 | 922 | 1,024 | 1,277 | 1,531 | 1,785 |
| 25 | 1,258 | 878 | 986 | 1,095 | 1,366 | 1,637 | 1,909 |
| 30 | 1,380 | 928 | 1,043 | 1,157 | 1,444 | 1,730 | 2,017 |

**The crossover rises with Mining level.** Refining 1 loses to raw selling at
every Mining level. The break-even Refining level is about **3 at Mining 1, 5 at
Mining 10, and 8 at Mining 30** — the faster a player mines, the more the
refine loop's fixed 126 s and 25% smaller load cost them. Because Refining
levels roughly 1.8× faster than Mining per hour invested (it pays XP on failures
too, at 3 XP a time), a player who refines consistently stays ahead of that
curve naturally; a player who mines hard and refines rarely falls behind it.

## 6. Power Cells and Scavenge

### 6.1 Power Cells

A Power Cell is not equipped. It is consumed to refill the Salvage Cutter to its
maximum charge of 10, and refills only from zero (`server/mining-commands.ts:274-313`).
One charge is spent per **boosted attempt, success or failure**, so one Cell buys
exactly 10 boosted attempts. The boost halves attempt duration (6.0 s → 3.0 s)
and changes **nothing** about success chance, yield, or XP.

One Cell therefore saves a flat **30 seconds** of mining. Its worth is entirely a
function of what 30 seconds of mining is worth at that level.

| Mining level | Shale those 30 s yield | Credits created | vs selling the Cell (3 Cr) | vs buying one (8 Cr) |
| --- | --- | --- | --- | --- |
| 1 | 2.62 | 5.25 | +2.25 | −2.75 |
| 5 | 3.30 | 6.59 | +3.59 | −1.41 |
| 10 | 4.14 | 8.28 | +5.28 | **+0.28** |
| 15 | 4.98 | 9.96 | +6.96 | +1.96 |
| 20 | 5.82 | 11.64 | +8.64 | +3.64 |
| 30 | 7.50 | 15.00 | +12.00 | +7.00 |

Three separate decisions, with three different answers:

- **Use a claimed Cell rather than sell it: always correct.** Even at Mining 1
  the Cell creates 5.25 Credits of Shale against a 3-Credit buyback.
- **Buy an extra Cell at 8 Credits: only from about Mining 10.** Below that it is
  a net loss. This is a genuinely interesting decision rather than a trap, and it
  gets stronger as the player levels.
- **Sell a Cell: never optimal for a mining character.** The 3-Credit buyback is
  below the Cell's use value at every level.

**Free supply, kept separate from repeatable income.** The DeWhat? Emergency
Power Annex issues **5 Cells per character per Pacific calendar day**, free, one
walking leg from Holo Hollow (`game/domain/power-annex.ts:5-27`). That is a
time-gated allotment, not repeatable income: it is worth 15 Credits/day if sold,
or 50 boosted attempts — about 2.5 minutes of saved mining time per day, worth
26-75 Credits of Shale depending on Mining level. The claim is all-or-nothing: if
all 5 will not fit, nothing is granted and no claim is recorded.

### 6.2 Scavenge

One opportunity per **walking** leg (never on a ride), appearing at a random tick
in [3, 30] of the 40-tick leg, open for 5 ticks (3 s) plus a 1 s server grace.
70% of outcomes award an item.

Expected value of one claimed opportunity, at Bix's buyback:

| Outcome family | Expected units | Expected Credits |
| --- | --- | --- |
| Ferrite Shale (1/2/3 at 20%/12.5%/7.5%) | 0.675 | 1.35 |
| Refined Ferrite (1/2 at 10%/7.5%) | 0.250 | 2.50 |
| Power Cell (1/2 at 7.5%/5%) | 0.175 | 0.53 |
| Nothing (4 outcomes at 7.5% each) | — | — |
| **Total** | | **4.38** |

This is **economically meaningful, not noise**. At 4.38 Credits per leg, a
four-leg raw-sell round trip yields ~17.5 Credits of Scavenge against 160
Credits of Shale — about 11% of gross income, and it is the reason the Crew
Hauler is close to neutral. Valued at Power Cell *replacement* cost (8 Cr)
rather than buyback, the figure rises to 5.25 Credits per leg.

Scavenge is the only early-game source of Refined Ferrite that does not require
Refining, and at 2.50 Credits per leg it is the largest single contributor to
that total. Claiming requires attention inside a 3-second window, so the realised
rate for an inattentive player is lower — treat 4.38 as a ceiling.

## 7. One-time progression economy and material opportunity cost

### 7.1 One-time injections — never fold these into Credits/hour

| Source | Credits | Items | Timing |
| --- | --- | --- | --- |
| Character creation | 10 | — | start |
| Walk It Off | — | Salvage Cutter ×1 | completion |
| Cut Your Teeth | — | — | completion (Mining +100 XP) |
| Waste Not | — | — | completion (Refining +100 XP) |
| Hold It Together | — | — | completion (Welding +100 XP) |
| Keep the Change | **24** | — | **acceptance** |
| Out of the Weather *(optional)* | — | — | completion (Welding +250 XP) |
| 10,000 Hours | — | Scrap Metal ×6 | acceptance |
| 10,000 Hours | **50** | — | completion |

**The entire authored Credit faucet on the mandatory path is 84 Credits.**
Everything else a player spends must be earned by selling. That is roughly nine
minutes of Mining-1 raw selling, so the one-time economy is flavour, not a
foundation.

The 24-Credit Keep the Change grant is paid on **acceptance** and the Mission
consumes 3 Power Cells — which cost exactly 24 Credits at Bix, or nothing at all
from the Annex. The grant is precisely sized to the purchase it substitutes for.

### 7.2 Direct Credit sinks

| Sink | Cost | Availability |
| --- | --- | --- |
| Power Cell (Bix) | 8 each | always |
| Scrap Metal (Wade) | 2 each | `10,000 Hours` accepted |
| Crew Hauler fare | 5 per ride | `Out of the Weather` complete |

There are exactly three. Nothing else in the shipped game removes Credits.

### 7.3 Material opportunity cost — what repairs really cost

Repair materials are consumed **up front** by `contributeRepairMaterials`, not
per increment; welding afterwards is pure time and XP
(`server/repair-commands.ts:260-287`, `game/domain/welding-repair.ts:113-122`).

| Consumer | Physical recipe | Merchant-sale value forgone | Mandatory? |
| --- | --- | --- | --- |
| Cargo Hold repair | 15 Refined Ferrite + 6 Slag | 15×10 + 6×1 = **156 Cr** | yes (Hold It Together) |
| Crew Stop repair | 20 Refined Ferrite | 20×10 = **200 Cr** | **no** (Out of the Weather) |
| Keep the Change | 3 Power Cells consumed | 3×3 = 9 Cr (or 24 Cr to buy) | yes |
| Practice weld | 2 Scrap in, 2 Slag out | 4 Cr spent − 2 Cr recovered = **2 Cr net** | per weld |

The material bill dwarfs the Credit bill. **356 Credits of merchant value** is
burned by the two authored repairs — more than four times the 84 Credits the
entire Mission chain ever grants.

The Cargo Hold's 15 Refined Ferrite also has a hidden production cost. At
Refining 1 a 60-Shale load — the largest that refines at all (§5.1) — yields
about 12 Refined Ferrite, so the mandatory first repair takes **at least two full
mine-and-refine trips**, roughly 75 Shale, before it can even be started. That is
the real gate on `Hold It Together`, not the welding.

## 8. Practice Welding and the real cost of Welding 5

### 8.1 Mechanics, measured

| Fact | Value |
| --- | --- |
| Sections per Practice weld | 10 |
| Section duration | 3.0 s |
| Practice XP per section | 10 — derived as 20% of the global 50, not a second constant |
| XP per completed weld | 100 (measured through the resolver) |
| Scrap consumed | 2, **at the instant the weld begins**, never refunded |
| Slag produced | 2, **at completion only** |
| Scrap cost | 4 Credits (Wade, 2 each) |
| Slag resale | 2 Credits (Bix, 1 each) |
| **Net material cost per weld** | **2 Credits** |
| Weld elapsed — 0 Clean Pass claims | 30 s |
| Weld elapsed — 1 claim | 27 s |
| Weld elapsed — 2 claims | 24 s |

Practice pays a reduced XP share because nothing is being repaired; authored
repairs and future Work Orders pay the full 50.

### 8.2 Clean Pass is a time mechanic, not an XP mechanic

Every Welding work unit rolls exactly two opportunities, at section 2-4 and then
2-4 sections later again (so 4-8). A claim **advances the work one section and
pays that section's ordinary XP**, with no tick cost
(`server/clean-pass.ts:38-41, 126-149`). A claim can never be the completing
section.

The consequence, which matters for the Work Order model: a fully-claimed
10-section weld still awards exactly 100 XP. **Clean Pass never increases total
XP or changes materials — it only removes up to 2 sections' worth of elapsed
time**, a maximum saving of 20% (6 s of 30 s). Abandoning a weld forfeits the
Scrap and any open window, but keeps completed sections' XP and the partial
progress.

### 8.3 Cost to reach the Work Order requirement

Work Orders require **Welding 5 = 2,320 XP** (`balance.workOrders.requiredWeldingLevel`).

Welding XP available from shipped content, by path:

- **Mandatory:** Cargo Hold repair 12 increments × 50 = 600, Hold It Together
  completion +100, `10,000 Hours`' own 3 Practice welds 3 × 100 = 300. **Total
  1,000.**
- **Optional (Out of the Weather):** Crew Stop repair 10 × 50 = 500, completion
  reward +250. **Total 750.**

| Progression case | Welding XP at `10,000 Hours` complete | XP remaining | Practice welds | Scrap needed | Free Scrap left | Scrap cost | Slag resale | **Net cost** | Weld time, 0 claims | Weld time, 2 claims |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Main path only | 1,000 | 1,320 | **14** | 28 | 0 | 56 Cr | 28 Cr | **28 Cr** | 7.0 min | 5.6 min |
| Main path + Out of the Weather | 1,750 | 570 | **6** | 12 | 0 | 24 Cr | 12 Cr | **12 Cr** | 3.0 min | 2.4 min |

The Mission's 6 free Scrap are exactly consumed by the 3 welds the Mission itself
asks for, so **none carries over** into the grind toward Welding 5.

**The grind is not the expensive part.** 28 Credits and 7 minutes is trivial
against a 567-1,380 Cr/h income. The optional branch that halves it costs **200
Credits of Refined Ferrite** to complete — so a player who does Out of the
Weather *for the Welding XP* pays roughly 200 Credits to save 16 Credits and 4
minutes. Out of the Weather is worth doing for the Crew Hauler and the content,
not as an economic shortcut to Welding 5.

**Travel sensitivity.** Wade's merchant and the Practice bench are the *same*
location (`game/content/locations.ts:188-196`), so buying Scrap costs no travel
at all: the player buys, welds, and buys again standing still. Scrap does not
stack (`stackLimit: 1`), so 8 slots hold only 8 Scrap — 4 welds — making the main
path's 14 welds about four buy-and-weld cycles in place, not four journeys.

The only travel in the Practice loop is the **Slag resale**: Bix is one walking
leg away in Holo Hollow, 48 s round trip, and the main path's 14 welds yield 28
Slag worth 28 Credits. Slag also does not fit alongside a working Scrap supply
for long (stack 10, 8 slots total), so a player either interleaves resale trips
or uses the auto-discard setting and forgoes the 28 Credits entirely. At
~1,000 Cr/h a single 48 s round trip costs ~13 Credits of forgone mining, so
consolidating the Slag into one or two trips is worth it and discarding it
outright is close to neutral — a genuine choice rather than an obvious optimum.

## 9. Economy by progression state

Nothing below assumes a character has completed anything they have not.

| Snapshot | Available income | Available sinks | Notes |
| --- | --- | --- | --- |
| **Start → Walk It Off** | none | none | 10 Credits, no Cutter, no merchant met |
| **Cut Your Teeth → Hold It Together** | Mining + raw sell, **567-696 Cr/h** at Mining 1-5; Refining unlocked at Waste Not | Power Cells (8 Cr) | Walk both ways only. Scavenge available on every leg. Must fund 156 Cr of Cargo Hold material out of production |
| **Keep the Change** | same | +3 Power Cells consumed | +24 Cr on accept, exactly the cost of buying the Cells |
| **Out of the Weather** *(optional)* | same, plus ride-out option | +5 Cr per ride | Costs 200 Cr of Refined Ferrite; the Hauler is near-neutral below Mining 15 |
| **10,000 Hours accepted** | same | +Scrap at 2 Cr | Wade's yard opens; Practice Welding begins; 6 free Scrap |
| **10,000 Hours complete → Welding 5** | **849-1,477 Cr/h** typical at Mining 10 / Refining 5-10 | Practice Welding at 2 Cr/weld net | +50 Cr. Work Orders terminal revealed but empty until Welding 5. 28 Cr and 7 min of Practice remain |

By the time Work Orders become relevant, a character is earning roughly
**850-1,200 Credits/hour** and has spent essentially all of it on repair
materials rather than on Credits-denominated purchases.

## 10. Work Order parametric model — modelling only

`docs/work-orders.md` leaves material quantities, section counts, and payouts
**TBD**. This section supplies the arithmetic for that decision and resolves
none of it. Nothing here should be written back into that document.

Let `M` = Refined Ferrite consumed, `S` = genuine Welding sections, `P` = Credit
payout, `c` = Clean Pass sections claimed (0-2).

| Quantity | Formula |
| --- | --- |
| Material opportunity cost | `10 × M` Credits (Bix buyback) |
| Active Welding time | `(S − c) × 3` seconds |
| Welding XP earned | `S × 50` (full rate, not Practice's 10) |
| Net Credit gain | `P − 10M` |
| Marginal labor rate | `(P − 10M) / ((S − c) × 3 s)` |
| **Break-even material floor** | **`P > 10M`** |

Two further facts the model must respect:

- **Clean Pass constrains `S` from below.** Opportunities land at sections 2-4
  and then 4-8, capped at 2 claims regardless of `S`, and the claim handler
  *throws* rather than let a claim be the completing section
  (`server/clean-pass.ts:126-128, 189-191`). The rolling rule is documented as
  assuming the current 10- and 12-section work units
  (`game/domain/clean-pass.ts:74-79`). A Work Order with `S ≤ 8` can therefore
  roll an opportunity on its own final section and hit that guard. **`S ≥ 9`
  should be treated as a hard implementation constraint** unless the
  implementation issue re-derives the Clean Pass rolling rule for short work
  units. The `S = 6` rows below are kept only to show the shape of the
  arithmetic; they are not implementable as-is.
- At 50 XP per section, a single `S = 16` Work Order pays 800 Welding XP — **8×
  a Practice weld for 1.6× the time.** Work Orders are a dramatically faster
  Welding progression route than Practice, independent of their payout.

### 10.1 Marginal scenarios — "weld this Ferrite or sell it?"

| M | S | P | Material cost | Net gain | Premium | Welding XP | Weld time (0 claims) | Marginal Cr/h (0 claims) | Marginal Cr/h (2 claims) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 6 | 50 | 40 | 10 | +25% | 300 | 18 s | 2,000 | 3,000 |
| 4 | 6 | 60 | 40 | 20 | +50% | 300 | 18 s | 4,000 | 6,000 |
| 4 | 6 | 80 | 40 | 40 | +100% | 300 | 18 s | 8,000 | 12,000 |
| 4 | 10 | 50 | 40 | 10 | +25% | 500 | 30 s | 1,200 | 1,500 |
| 4 | 10 | 60 | 40 | 20 | +50% | 500 | 30 s | 2,400 | 3,000 |
| 4 | 16 | 50 | 40 | 10 | +25% | 800 | 48 s | 750 | 857 |
| 4 | 16 | 80 | 40 | 40 | +100% | 800 | 48 s | 3,000 | 3,429 |
| 6 | 10 | 75 | 60 | 15 | +25% | 500 | 30 s | 1,800 | 2,250 |
| 6 | 10 | 90 | 60 | 30 | +50% | 500 | 30 s | 3,600 | 4,500 |
| 6 | 16 | 75 | 60 | 15 | +25% | 800 | 48 s | 1,125 | 1,286 |
| 10 | 10 | 125 | 100 | 25 | +25% | 500 | 30 s | 3,000 | 3,750 |
| 10 | 10 | 150 | 100 | 50 | +50% | 500 | 30 s | 6,000 | 7,500 |
| 10 | 16 | 125 | 100 | 25 | +25% | 800 | 48 s | 1,875 | 2,143 |
| 10 | 16 | 200 | 100 | 100 | +100% | 800 | 48 s | 7,500 | 8,571 |

These marginal rates look enormous — 750 to 12,000 Cr/h — because the denominator
is only 18-48 seconds of welding. **Do not read them as income.** They answer
one narrow question: given Ferrite already in hand, is welding it better than
selling it? Above the floor, the answer is always yes.

### 10.2 Full-cycle scenarios — "is the Work Order loop worth running?"

The honest denominator includes producing `M` Refined Ferrite. Measured at
Mining 10 / Refining 10, one refine loop takes 731 s and yields 20.5 Refined
Ferrite: **35.6 s per unit**.

| M | S | P | Time to produce M | Full cycle | **Work Order Cr/h** | Selling that Ferrite instead |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | 6 | 50 (+25%) | 143 s | 161 s | 1,121 | 1,010 |
| 4 | 10 | 50 (+25%) | 143 s | 173 s | 1,043 | 1,010 |
| 4 | 16 | 50 (+25%) | 143 s | 191 s | **945** | 1,010 |
| 4 | 16 | 60 (+50%) | 143 s | 191 s | 1,134 | 1,010 |
| 6 | 10 | 75 (+25%) | 214 s | 244 s | 1,107 | 1,010 |
| 6 | 16 | 75 (+25%) | 214 s | 262 s | **1,031** | 1,010 |
| 6 | 16 | 90 (+50%) | 214 s | 262 s | 1,237 | 1,010 |
| 10 | 10 | 125 (+25%) | 356 s | 386 s | 1,165 | 1,010 |
| 10 | 16 | 125 (+25%) | 356 s | 404 s | 1,113 | 1,010 |
| 10 | 16 | 200 (+100%) | 356 s | 404 s | 1,780 | 1,010 |

**A 25% labor premium is not automatically a raise.** At `S = 16`, `M = 4` it
returns 945 Cr/h against 1,010 Cr/h for simply selling the Ferrite — the player
is paid *less* for doing more work. The premium has to clear the section time it
buys, and longer jobs need a larger premium to stay attractive at the same `M`.

Two structural properties fall out of the arithmetic:

- **Premium scales with `M`, section time does not.** A fixed percentage premium
  on a larger `M` buys proportionally more Credits for the same welding, so
  larger-`M` jobs look better at identical premium and `S`. If low-level jobs
  should feel comparable regardless of size, the premium needs to grow with `S`,
  not only with `M`.
- **The floor is a floor, not a target.** `P = 10M` pays exactly nothing for the
  labor. Every scenario above is expressed as a multiple of that floor precisely
  so the size of the premium stays visible.

### 10.3 Benchmarks

| Repeatable loop | Credits/hour |
| --- | --- |
| Mining 10, raw sell, walk both ways | 849 |
| Mining 30, raw sell, walk both ways | 1,380 |
| Mining 10 + Refining 10, sell refined | 1,057 |
| Mining 30 + Refining 20, sell refined | 2,017 |
| Practice Welding | −240 (pure cost; earns no Credits) |

A Work Order that should feel like *better* work than mining needs a full-cycle
rate above ~1,050 Cr/h at the Mining 10 / Refining 10 profile; one that should
feel like *specialist* work comparable to a well-levelled refiner needs to
approach ~2,000 Cr/h. **This audit deliberately does not choose between those.**

## 11. Assumptions and modelling choices

Facts above are measured. These are the judgement calls, stated so they can be
challenged:

1. **Realistic load = 8 slots.** Only one container is ever provisioned and no
   merchant sells a second, so 8 slots is the shipped reality. A second container
   would double slot capacity and change every loop figure.
2. **The Cargo Hold's 32 storage slots are excluded.** It is stationary storage
   at the Crash Site, gated behind its own repair, and it does not change carried
   capacity during a run — which is what caps every loop above. The Crash Site is
   two walking legs from The Jag, the same as Bix, so a player *could* use it as
   a staging bank; that would not raise any Credits/hour figure here, because it
   stores rather than buys and the return trip to Bix remains.
3. **Travel is modelled as shortest-path walking** over the authored adjacency,
   with no stops. Local Place entry is free.
4. **Scavenge is modelled at full claim rate.** Every opportunity claimed inside
   its 3-second window. A realistic player claims fewer; treat 4.38 Cr/leg as a
   ceiling.
5. **Scavenge output is valued at Bix's buyback**, including Power Cells at 3
   rather than their 8-Credit replacement cost. This understates Scavenge for a
   mining character.
6. **Credits/hour figures are continuous-play rates** with no idle time,
   inventory management, or UI interaction. They compare loops against each
   other; they are not a prediction of what a session earns.
7. **Mining and Refining levels are varied independently.** In play they
   correlate, since refining consumes what mining produces.
8. **Mission XP literals** (100/100/100/250 and the 24/50 Credit grants) are read
   from `game/content/missions.ts` and cited, not re-derived; they are content,
   not balance config.
9. **Work Order scenarios are illustrative grid points**, not authored
   candidates. `M ∈ {4, 6, 10}`, `S ∈ {6, 10, 16}` and premiums of 25/50/100%
   were chosen to span the plausible low-level space, nothing more.

## 12. Findings and open product questions

All of the following are **proposals requiring separate approval**. None has been
implemented, and no balance value was changed by this audit.

### Findings worth a decision

1. **A full 80-Shale load cannot be refined at all** (§5.1). 70 Shale stalls
   after one attempt; 60 is the practical refining load. This is emergent
   behaviour of a correct capacity rule, but it is invisible to the player, who
   discovers it by walking three legs to the Yard with an unrefinable load. Worth
   a product decision about whether to surface it, change it, or leave it.
2. **Refining at low Refining level is a time loss, not a gain** (§5.3).
   Value-positive per attempt but Credits/hour-negative until roughly Refining 5.
   `Waste Not` teaches the loop at exactly the level where it is worst.
3. **The Crew Hauler is near-neutral and can be negative** (§4). Fare plus the
   forgone Scavenge opportunity roughly equals the time saved below about Mining
   15. If it is meant to feel like a convenience upgrade, it currently is not one.
4. **The authored Credit faucet is 84 Credits against 356 Credits of mandatory
   and optional repair material** (§7). The early economy is materials-denominated;
   Credits are almost vestigial until Wade's Scrap arrives.
5. **Out of the Weather is an economic loss as a Welding shortcut** (§8.3): ~200
   Credits of Refined Ferrite to save 16 Credits and 4 minutes of Practice. Fine
   if it is sold on the Hauler and the content; worth knowing it is not a
   progression shortcut.
6. **Scrap Metal's `stackLimit: 1` makes Practice logistics the real cost**
   (§8.3), not the 2 Credits per weld. Eight slots carry four welds.
7. **Work Orders will be a far faster Welding progression route than Practice**
   (§10) — 50 XP/section versus 10. Whatever the payout, that alone will change
   how players reach Welding 6+.
8. **Clean Pass puts a floor under the section count** (§10). A work unit of 8
   sections or fewer can roll an opportunity on its own final section, which the
   claim handler refuses by throwing. The `short` length category in
   `docs/work-orders.md` must not be read as "fewer than 9 sections" without the
   implementation issue first re-deriving the Clean Pass rolling rule, which its
   own comment says was written for the current 10- and 12-section work units.

### Questions for the product owner

1. Should a low-level Work Order **beat, match, or trail** the refine-and-sell
   loop on full-cycle Credits/hour? §10.2 shows a 25% premium can land *below*
   it; the answer determines whether the premium should be a percentage of `10M`
   or a per-section labor rate.
2. Should the labor premium **scale with `S`**? A flat percentage of material
   value pays nothing extra for a longer weld, so longer jobs are strictly worse
   at equal `M`.
3. Is the **Refined Ferrite quantity** meant to be a meaningful stockpiling
   decision? At 35.6 s per unit, `M = 10` is about 6 minutes of production —
   substantial; `M = 4` is about 2.5 minutes.
4. Should Clean Pass's 20% time saving be part of the payout calculus at all, or
   treated as a skill bonus the balance ignores?

### Explicitly not done

Per the issue's hard stop: no gameplay, balance, persistence, schema, content, or
player-facing value was changed; `docs/work-orders.md` and its TBDs are
untouched; no Work Order was implemented; no public Update or Wiki page was added,
because nothing player-visible changed.
