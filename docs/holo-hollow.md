# Holo Hollow — Settlement, Economy, and First-Town Design

## Status and scope

This document is the canonical approved product/design direction for Holo Hollow.
It records settled worldbuilding, first-town structure, NPC roles, Credits, the
initial merchant economy, and the first-slice player-facing UX.

The Holo Hollow foundation shipped in PR #167 (issue #159). The **Holo Hollow
foundation (shipped in #167)** section below records what is live and what
remains deferred. Everything else here is approved direction, not a claim that
the described system exists yet.

Existing authoritative gameplay mechanics remain owned by their current docs:

- Mining, Refining, Power Cells, Cargo Hold repair, and Travel timing/rules:
  `docs/gameplay-foundations.md`
- Local Place and Credits/merchant-transaction mechanical contracts:
  `docs/gameplay-foundations.md`
- NPC conversation model and Local-Place resident resolution:
  `docs/npc-conversations.md`
- Art direction, generation workflow, asset preparation, and visual QA:
  `docs/art-cookbook.md`
- Mission framework and shipped Mission progression: `docs/missions.md`
- Location/Map/Journey surface ownership: `docs/location-scenes.md` and
  `docs/travel-map-design.md`
- General game rules and server-authoritative boundaries: `docs/game-rules.md`
  and `docs/architecture.md`

This document should not duplicate those contracts. It owns Holo Hollow's
approved product direction and the boundaries future implementation must honor.

## Settlement identity

Holo Hollow is a declining Ferrite-mining settlement built on the remains of a
former holo-tourism economy.

Its major tourist draw was the nearby Holo Drive-In / projector complex. Families
once traveled to Holo Hollow to watch holo entertainment, buy souvenirs, stay in
family lodging, eat, and spend money across the settlement.

The entertainment industry later moved to a newer distribution/encoding format.
Holo Hollow's projector remained compatible with legacy media but could not show
new releases, and the town could not afford the compatible replacement or
upgrade. Tourism collapsed.

The settlement adapted around Ferrite extraction, limited local Refining, repair
work, hauling, and gig/delivery work. Ferrite is now itself a declining trade:
newer materials are increasingly preferred and Ferrite extraction faces tighter
regulation and environmental scrutiny.

Holo Hollow should feel economically strained, dirty, and diminished without
becoming a misery exhibit. It is still a home. Residents retain humor, routines,
friendships, local pride, traditions, food, ridiculous stories, and things they
believe are worth preserving.

A useful thematic question is:

> What happens to people when the thing their community was built around stops
> mattering?

Different residents should answer that question differently through nostalgia,
adaptation, resentment, pragmatism, departure, reinvention, or attempts to
rebuild.

## Government and Ferrite regulation

The broad federal-ish authority is the **S.S.A. — Settled Systems Authority**.
A narrower extraction/resource regulator may exist later; its name is not yet
canon.

Ferrite regulation should support legitimate disagreement. Extraction may cause
real environmental harm, while quotas and enforcement may also threaten the
livelihoods of people with few alternatives. Do not frame the regulator as a
cartoonishly evil "space EPA," and do not frame every local as using the same
illegal workaround.

Locals may bend or evade limits in varied ways — aliases, pooled quotas, buyers
looking away, informal arrangements, corruption, or other workarounds — but
compliance and attitudes should differ by person.

## Geography: World Locations and Local Places

### Holo Hollow proper

Holo Hollow begins as **one World Location / world-map hex** at approved axial
coordinate **`(-1, 1)`**.

At that coordinate Holo Hollow is directly adjacent to:

- **Crash Site**;
- **Emergency Power Annex**;
- **The Long Scramble**.

It is **not** directly adjacent to The Jag or the Abandoned Processing Yard.
This is intentional. Wade can send the player directly into town, Bix's Power
Cell advice naturally points toward the nearby Annex, and the Long Scramble
remains part of the physical route toward The Jag instead of Holo Hollow becoming
a universal hub.

The exact Holo Drive-In coordinate remains deferred. When implemented, it should
occupy a neighboring World Location / world hex consistent with the approved
Holo Hollow geography.

RuneSpace should distinguish two spatial concepts:

- A **World Location** participates in the world map. It owns map position,
  adjacency, ordinary Travel/Journey semantics, and the character's authoritative
  persisted world position.
- A **Local Place** belongs to exactly one parent World Location. It has no
  world-map coordinate or adjacency of its own and does not become a Travel
  destination merely because the player can enter it.

Businesses, social spaces, and other places inside Holo Hollow are Local Places
available only while the character is physically at the Holo Hollow World
Location. Entering a Local Place is immediate and does not:

- start Travel or Journey;
- award Travel progression;
- create a Scavenge opportunity;
- change the character's authoritative world location.

A Local Place may have its own:

- stable content identity;
- name and description;
- scene/location art;
- resident NPC;
- activities and interactions;
- merchant or other feature ownership where appropriate;
- derived access state;
- clear return control to the parent World Location surface.

The first implementation needs only **one level** of Local Places. Do not build a
recursive place-within-place hierarchy until a real future gameplay requirement
proves that it is necessary.

The Holo Hollow Location surface should list its Local Places. Opening one should
feel like entering a real place, not opening a generic modal and not pretending
the building is another World Location.

Which Local Place the player is viewing is presentation/navigation state, not a
second persisted character coordinate. The shipped foundation keeps it in the
route-backed Play composition's `place` query parameter so it survives normal
refresh/history behavior (`docs/gameplay-foundations.md` owns that contract).
The invariant is that the database continues to say the character is at Holo
Hollow.

Client navigation into a Local Place never grants gameplay permission by itself.
Server-authoritative commands such as merchant trades must still validate the
owned character's current World Location, stationary state, requested Local
Place, current access, and the authoritative feature/content rules.

This Local Place concept should be generic enough to support later settlements,
stations, facilities, businesses, or comparable contained places without
Holo-Hollow-specific conditionals. Do not force existing simple World Locations
to author Local Places when they do not need them, and do not refactor unrelated
existing location/activity branches merely to make the abstraction look more
universal.

### Visible-but-locked Local Places

A Local Place may be visible before it is enterable. Presentation should consume
a generic derived access result, such as available or locked plus a player-facing
reason, rather than hard-coded checks for one named building.

Do not build a broad generic requirements DSL preemptively. Add only the smallest
condition mechanism proven necessary when a real Mission/world-state unlock is
implemented.

**HH B&B** is the first example. It shipped visible but locked in #167, and
#170 supplied its unlock: Keep the Change introduces Mara Kells and, on
completion, makes the place enterable. Access derives from that Mission's
completion through the one generic access predicate — no second persisted
unlock flag exists (`docs/gameplay-foundations.md`, Local Places).

The locked place should remain visible so the player can notice that the world
changed when access is later granted.

### NPC presence in Local Places

The foundation does not require a generic simultaneous multi-NPC interaction
system.

Persistent NPC presence should resolve from the relevant spatial context:
ordinary existing World Locations can continue to behave as they do now, while
Holo Hollow's resident interaction is scoped to the active Local Place. Bix is
the resident interaction in his shop and Renn is the resident interaction at the
Community Assistance Center.

Mara's appearance in Bix's shop during the Wade apprentice Mission is an
authored dialogue beat. It does not make Mara a persistent second shop
NPC and did not justify building multi-NPC interaction UI. As shipped in #170 it
needed no new system at all: a dialogue beat already carries its own
`speakerNpcId`, so Mara simply speaks inside Bix's own authored sequence while
`getResidentNpc` keeps resolving exactly one resident per place.

### Holo Drive-In

The Holo Drive-In / projector site is a **separate nearby World Location / world
hex**. Travel between Holo Hollow and the Drive-In uses ordinary Travel/Journey
semantics. Do not invent a special short intra-town travel rule for it.

### Class and district boundaries

Do not split Holo Hollow into multiple world hexes merely to express richer and
poorer areas. Initially communicate class/economic differences through art,
architecture, cleanliness, prices, accessibility, NPCs, and dialogue.

A later district may become its own World Location only when unique gameplay,
NPC density, businesses, Missions, or persistent world-state meaning justify the
extra geography.

## First residents and businesses

### Bix Weller — Holo Hollow Souvenirs + Mining Supplies

Bix Weller runs **Holo Hollow Souvenirs + Mining Supplies**.

The business should visibly preserve its tourism history: the original **Holo
Hollow Souvenirs** sign remains, with a rough later **+ Mining Supplies** addition
painted or bolted onto it.

Bix fundamentally still thinks of the business as a souvenir shop that happens
to sell mining supplies, even though mining/material business is effectively all
it does now. This is mild denial and identity preservation, not a joke he is
performing for the player.

His parents owned the shop during the tourism era. Bix grew up there, later took
over the business, and is roughly Wade Rusk's age. Bix and Wade grew up together
and likely went to school together, giving their present-day teasing and
familiarity a long history.

Bix is dry, observant, mildly sarcastic, and fundamentally decent. He will make
money from the player, but he will not make money from the player being stupid.
He may provide useful local knowledge even when doing so is not the most
profitable possible choice.

Bix misses Holo Hollow's tourism years and believes the town may yet recover
that part of its identity.

### Mara Kells — HH B&B

Mara Kells owns **HH B&B**, the family bed-and-breakfast her family operated for
families visiting Holo Hollow during the tourism years.

As tourism disappeared, Mara adapted the business into the town's practical
inn/cantina for locals, miners, haulers, contractors, and working travelers.
Unused tourist infrastructure became useful because Mara accepted the town that
actually existed rather than waiting for the old one to return.

Mara loves Bix and has known him for years, but thinks he is a dingdong for
assuming tourism will simply come back. She is the pragmatic counterpoint to
Bix's nostalgia.

HH B&B remains a useful long-term home for future systems such as rest/healing,
food, combat consumables, lodging, travelers, rumors, and Mission encounters,
but those mechanics should not be built before gameplay creates a real need.

### Renn Calder — pessimistic younger miner

Renn Calder is a younger Ferrite miner, roughly late 20s to early 30s, who grew
up after Holo Hollow's tourism boom was already mostly gone.

Renn cares about Holo Hollow but thinks the older generation often confuses
loyalty with denial. Renn believes Ferrite has little long-term future and would
tell younger residents such as Tansy not to sacrifice their whole lives to the
town.

Renn should initially exist primarily for social/worldbuilding conversation, not
as a merchant or Mission dispenser. Renn provides an important third view of
Holo Hollow:

- Bix: the old Holo Hollow can come back;
- Mara: stop waiting and make the current town work;
- Renn: neither version has much future, so leave while you still can.

Renn's initial encounter Local Place is the Holo Hollow Community Assistance
Center, keeping a social NPC available even before HH B&B unlocks.

## Repurposed tourism infrastructure

### Holo Hollow Community Assistance Center

The former Holo Hollow Visitor Center is now the **Holo Hollow Community
Assistance Center**.

The old visitor-center identity should remain visibly legible beneath newer
practical municipal/government labeling. The building handles local assistance
and ration distribution.

Cheap, unappetizing but nutritious daily rations may be referenced through art,
dialogue, or worldbuilding. Do **not** implement a player-facing ration claim,
food item, healing effect, or consumable system until food/healing gameplay has
an actual purpose.

### DeWhat? Emergency Power Annex

The Annex is **old S.S.A.-required emergency-continuity infrastructure from
Holo Hollow's tourism era** (canon established in #170).

When projector nights still brought families and travelers into a remote
settlement, the Settled Systems Authority required a public emergency-power
depot so stranded residents and travelers could keep essential systems running
until help arrived. **DeWhat? won the contract and installed the automated
Annex.**

Tourism later collapsed. The contract did not. The Annex remains active public
infrastructure and still issues its limited daily allotment of standardized
Power Cells.

The in-world purpose of the per-person daily limit is fair emergency access:
enough portable power for essential heat, comms, lighting, or tools without
letting one person empty the public reserve. The gameplay rule itself is
unchanged and owned by `docs/gameplay-foundations.md` (Daily Power Annex claim).

Free public Cells and Bix's paid stock coexist for ordinary economic reasons:
the allotment is personal and capped, it does not stock Bix's shelves for the
whole town, people may already have used theirs or need more than the limit,
some would rather pay than wait for a reset, and Bix buys spare Cells from
people who would rather have Credits.

This is worldbuilding around an existing mechanic. Do **not** turn it into a
government simulation, a ration system, or new daily persistence.

### Depot / hauler area

A depot, old parking/landing area, or hauler staging area may be visible in the
first town slice. It can foreshadow later paid transport and reinforce the town's
working economy.

**Shipped in #172** as the Crew Stop and the Crew Hauler. The realized form is
deliberately smaller than a depot: an old covered roadside pickup shelter on the
haul road where mining crews wait for the shift hauler out to The Jag. It is a
Local Place, not a World Location or a map hex, and there is no station, no
timetable, no ticketing, and no named driver.

The player can repair it through Renn's optional side Mission **Out of the
Weather** using the Welding they learned from Wade, after which the crews let
them ride out to the mine for 5 Credits. See "Out of the Weather" below.

### Future contract board

Tourism-era ticket/information infrastructure may later support a contract/job
board. The first foundation may visually foreshadow that future use, but the
full contract system is not part of the first town slice.

## Credits and first merchant economy

Credits are **character-scoped**, not account-scoped.

New characters begin with **10 Credits**.

Bix's initial approved playtest prices are:

| Item | Bix buys from player | Bix sells to player |
| --- | ---: | ---: |
| Ferrite Shale | 2 Credits | Not initially stocked |
| Refined Ferrite | 10 Credits | Not initially stocked |
| Slag | 1 Credit | Not initially stocked |
| Power Cell | 3 Credits | 8 Credits |

These values are approved **initial playtest balance**, not permanent sacred
economy constants. They should be authored centrally and tuned after real
playtesting when the wider item economy is visible.

The intended relationships matter more than preserving the exact numbers
forever:

- raw Shale has modest guaranteed value;
- successful Refining creates meaningful added value;
- Slag is disappointing but not worthless;
- ordinary merchant selling is convenient but financially mediocre relative to
  later authored contracts;
- Bix buys Power Cells even though the Emergency Power Annex provides a limited
  free daily allotment, because selling a Cell for a few Credits is an
  intentional player choice rather than misuse of the system;
- buying Power Cells is a useful convenience/time-value purchase rather than an
  automatic requirement.

A later Wade apprentice Mission asks the player to bring Tansy three Power
Cells. At the approved 8-Credit retail price, Wade provides exactly **24
Credits** for that purchase. The Mission still requires visiting/talking to Bix
even if the player already owns enough Cells.

### First merchant transaction UX

**Talk to Bix** and **Trade** are separate player actions. The later Wade Mission
can therefore require the Bix conversation independently of whether the player
actually buys Power Cells.

Trade uses one small reusable Buy/Sell surface:

- **Buy** initially contains Power Cells only;
- **Sell** initially contains Ferrite Shale, Refined Ferrite, Slag, and Power
  Cells;
- each item row shows its authoritative unit price and the player's owned
  quantity where relevant;
- quantity begins at **1** and provides minus, plus, and **Max** controls;
- the transaction total updates before commit;
- one explicit **Buy** or **Sell** action commits the selected transaction;
- do not add a redundant second "Are you sure?" confirmation modal after the
  player has already selected quantity and seen the total;
- after a successful transaction, the player remains in Bix's shop, Credits and
  inventory update immediately, and concise feedback confirms the result.

This is a reusable merchant interaction pattern, not a Bix-only one-off. The UI
must not invent its own inventory-stack removal/addition behavior; authoritative
trade commands reuse the game's inventory ownership and validation boundaries.

### Credit presentation

The current Credit balance should be prominent while trading and available in
Inventory/character information.

Do **not** add Credits to the persistent gameplay top bar in this first economy
slice. Credits are not relevant enough during every Travel/Mining/etc. moment to
justify permanent HUD space yet. A later economy expansion may revisit that
choice if the balance becomes continuously relevant.

## Holo Hollow foundation (shipped in #167)

The first slice established the town as a place and one small economic loop
without pulling future systems forward prematurely. It shipped in PR #167
(issue #159). Its mechanical contracts live in `docs/gameplay-foundations.md`
(Local Places, Credits, and merchant transactions) and
`docs/npc-conversations.md` (resident resolution and topics); this section
records the product-level shipped state.

### Shipped

- Holo Hollow as one World Location at axial coordinate `(-1, 1)`, adjacent to
  Crash Site, Emergency Power Annex, and The Long Scramble;
- Holo Hollow town Location presentation and generic Local Place navigation;
- one-level Local Places attached to exactly one parent World Location, with
  the open place held in route/presentation state rather than persisted
  character world position;
- generic derived visible-but-locked Local Place access presentation;
- Local-Place-scoped resident NPC resolution without simultaneous multi-NPC
  interaction UI;
- Holo Hollow Souvenirs + Mining Supplies, with Bix Weller as its resident;
- Holo Hollow Community Assistance Center, with Renn Calder as its resident
  social NPC;
- HH B&B visible but locked, with an in-world refusal reason;
- Mara Kells registered as HH B&B's resident identity only, with no authored
  conversation, portrait, or expression art yet;
- character-scoped Credits with a 10-Credit starting balance;
- Bix buying Ferrite Shale, Refined Ferrite, Slag, and Power Cells, and selling
  Power Cells, at the approved initial playtest prices in this document;
- separate Talk and Trade actions at Bix's shop;
- reusable Buy/Sell trade UX with quantity controls, Max, live total, and one
  explicit commit action without a redundant confirmation modal;
- Credit balance visible in Trade and Inventory, without a permanent Credit HUD
  element;
- a public Update announcing the town and initial player Wiki coverage.

Holo Hollow's early residents are Bix, Mara, and Renn. Do not add a fourth NPC
merely to hit a number. Add future residents when a distinct character need
exists.

### Shipped art

The foundation asset pass delivered:

- the Holo Hollow town scene, its World Location map identifier, and a copy of
  the town scene as the public Update hero;
- exterior Local Place scenes for Bix's shop, the Community Assistance Center,
  and HH B&B;
- dedicated conversation interiors for Bix's shop and the Community Assistance
  Center;
- Bix and Renn neutral portraits with two further expressions each.

Later Holo Hollow assets follow `docs/art-cookbook.md`; the runtime scene
contract is in `docs/location-scenes.md`.

**Known non-blocking art debt.** The three Local Place exteriors reuse nearly
identical surrounding/background composition, so the buildings read as if they
occupy almost the same spot. A later dedicated art polish pass should replace
them with more spatially distinct scenes while preserving the approved building
identities. This is future visual polish, not a reason to reopen #167.

Visible environmental hooks toward the depot/hauler area, future contract
board, and nearby Drive-In remain approved direction for later Holo Hollow art
and content; they are not recorded here as shipped.

### Deferred

Follow-up work, not part of the shipped foundation. Everything except the art
debt shipped afterwards in #170 (see "Keep the Change" below):

- ~~Wade's three-Power-Cell apprentice Mission~~ — shipped in #170;
- ~~Mara's authored Bix-shop appearance during that Mission~~ — shipped in #170;
- ~~Mara's portrait/expression set and the HH B&B conversation interior~~ —
  shipped in #170;
- ~~the HH B&B unlock on that Mission's completion~~ — shipped in #170;
- ~~the depot/hauler area and functional paid rides~~ — shipped in #172 as the
  Crew Stop and the Crew Hauler;
- replacing the similar Local Place exteriors (art debt above) — still open.

### Out of the Weather (#172)

RuneSpace's first deliberately optional side Mission, and the first permanent
player-made improvement to the world.

After **Hold It Together**, Renn Calder mentions the Crew Stop: the roof leaks,
the bench leans, everybody complains, and nobody owns it enough to fix it. The
player may choose to spend **20 Refined Ferrite** and **ten genuine Welding
increments** repairing it. Nothing forces them to, and ignoring it forever
blocks nothing — **Keep the Change is not a prerequisite and is not affected**.

The point of the Mission is that the world stays changed. The repaired shelter
keeps its repaired artwork and copy permanently, and because the crews use it
every workday and know who fixed it, they will squeeze the player onto the shift
hauler out to The Jag for **5 Credits a ride**. The ride is boarded at the
shelter itself — it belongs to the people who wait there, not to the town — and
it runs **one way only**: there is room for a passenger heading out, and none
coming back with the hauler loaded with shale, so the player walks home through
The Long Scramble like everybody else. It appears only once Renn has actually
been told: the repair changes the world the moment it is finished, but the
crews' willingness to carry the player arrives with the turn-in.

The reward is deliberately not a pile of Credits. It is 250 Welding XP on top of
the 500 the work already paid, plus a place that is better than it was and a
town that is a little easier to live in. Walking stays free, keeps its route
through The Long Scramble, and keeps its Scavenge opportunities — the ride is a
recurring choice between time and money, not a replacement.

The Mission establishes the pattern intended for later Holo Hollow restoration
work such as the projector/Drive-In arc: optional side content may permanently
make the world more useful without becoming a prerequisite for the main story.

### Still out of scope

- simultaneous multiple-NPC interaction UI or a generic multi-NPC scene system;
- recursively nested Local Places;
- a speculative generic Local Place requirements DSL;
- broad refactoring of existing simple World Location activity composition solely
  to make Local Places look universal;
- HH B&B rest/healing mechanics;
- food effects or combat consumables;
- player-facing ration claims;
- full contract/job-board system;
- functional depot rides/public transportation;
- player housing;
- free or paid town storage/warehousing;
- projector restoration implementation;
- post-restoration tourism/economic simulation;
- combat;
- a second town hex solely for class distinction;
- speculative generic city simulation or NPC scheduling.

## Keep the Change — the Wade apprentice Mission (shipped in #170)

This section recorded approved direction before implementation; it now records
what shipped. The Mission framework contract lives in `docs/missions.md`.

The Mission after **Hold It Together** does not auto-start. The player talks to
Wade after repairing the Cargo Hold.

Wade is reservedly pleased and declares the player his apprentice whether they
like it or not. During that conversation, Tansy contacts Wade through the
existing remote-dialogue/comms presentation and says she has run out of Power
Cells while Mining. Wade has none.

Wade sends his new apprentice to bring Tansy **3 Power Cells** and gives the
player exactly **24 Credits** — the retail cost of three Cells from Bix.

As shipped, the Mission:

- requires the player to visit and complete the authored conversation with Bix
  even if they already carry three Cells, and never requires Trade, a purchase,
  or a sale;
- accepts Cells from any legitimate source, including inventory owned before
  acceptance, the Annex allotment, and Bix's shelf, with no provenance tracking;
- lets the player keep every Credit they do not spend — there is no completion
  payout and no reimbursement;
- introduces Bix and Holo Hollow's merchant economy, including his joke about
  Wade providing exactly the purchase price and no delivery tip;
- has Bix explain the Annex's S.S.A./DeWhat? history, its per-person daily
  limit, and why he still sells Cells;
- introduces Mara as an authored guest speaker inside Bix's own dialogue
  sequence rather than a persistent second shop NPC, and that one-time encounter
  is not replayable afterwards;
- unlocks HH B&B only on completion, derived from the Mission record;
- stayed one sequential Mission on the generic framework, with four narrow
  generic extensions rather than Mission-specific code (`docs/missions.md`
  §8.1, §9.2, §12.3).

The player character stays silent throughout, as everywhere else in RuneSpace.

## Contracts and economic progression

Later contracts should generally **buy outcomes**, while Missions may require
performing behaviors because they teach or advance narrative progression.

Commercial contracts should normally accept inventory acquired before the
contract was accepted unless a specific authored contract gives a real in-world
reason not to. Do not add timed XP multipliers or anti-stockpiling systems merely
to force fresh production.

The intended later Cargo decision is:

- sell materials to Bix now for a mediocre guaranteed price; or
- keep valuable Cargo space occupied in hopes of a better authored contract
  later.

That gives the repaired Cargo Hold strategic meaning without adding free town
storage.

## Holo Drive-In and Tansy's longer arc

The old projector is obsolete, not simply dead. It can still show legacy-format
films, so local families continue a recurring cheap movie tradition with the
same old films everyone has seen and can quote from memory.

Wade used to take Tansy to the movies every Friday after her parents died,
continuing a tradition her parents had started with her. Establish the recurring
Wade/Tansy movie tradition before revealing its full emotional history so the
later detail has weight rather than functioning as an exposition dump.

A later projector-restoration/upgrade Mission should make the site compatible
with current releases again. That is tied to Tansy's longer character arc: she
has difficulty imagining leaving Holo Hollow while she believes the town has no
future. Seeing a credible path toward renewed visitors and reinvention is part of
what eventually allows her to feel okay leaving and traveling with the player.

Projector restoration should produce visible persistent consequences rather than
only completing a Mission checkbox. Later effects may include changed dialogue,
renewed visitors, reopened or improved businesses, new economic opportunities,
or modest physical changes.

Exact projector hardware, media-corporation names, implementation timing, and
post-restoration simulation remain future design work.

## Tone guardrails

- Do not turn every NPC into a Mission dispenser.
- Do not make Holo Hollow uniformly miserable.
- Do not dump town history through exposition when signage, reused buildings,
  conversation, Missions, and environmental details can reveal it naturally.
- Keep RuneSpace's satirical streak, but prefer believable people. Institutions,
  corporate products, bureaucracy, signage, and absurd circumstances can carry
  more of the joke than parody character names.
- Do not invent generic fantasy-RPG abstractions such as a Quest Guild or
  context-free General Store when Holo Hollow's history can produce a specific
  business instead.
- Preserve legitimate disagreement about Ferrite, regulation, staying, leaving,
  tourism, and the town's future.
