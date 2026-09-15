# NPC Canon — Internal Character Bible

> **INTERNAL. SPOILER-COMPLETE. NOT A PUBLISHING SOURCE.**
>
> This file contains unrevealed history, private motivation, and approved
> future story direction. It exists so that dialogue, Missions, Work Orders,
> shops, locations, art direction, and Updates stay consistent with one
> another.
>
> **Never generate a public Wiki article by copying from this file.** A Wiki
> article is a deliberate player-safe projection of canon, written from the
> `Public-Wiki-safe facts` field of an entry and nothing else. See
> `docs/public-wiki.md` and the **Public-Wiki projection rules** section below.

## Status and scope

This is RuneSpace's narrative reference for its named recurring characters. It
records who these people are, what they know, what they own, what the player
has and has not learned about them, and what is not decided yet.

It is **not** a second mechanical source of truth. Placement rules, Mission
structure, merchant prices, topic availability, and level curves are owned by
code and by the focused docs, and this file links to them rather than copying
values that could drift:

- stable IDs, roster, placement, relocation, expression art —
  `game/config/foundations.ts`, `game/content/npcs.ts`
- authored dialogue — `game/content/dialogue.ts`
- replayable topics and the conversation model — `game/content/conversation-topics.ts`,
  `docs/npc-conversations.md`
- Missions and the Mission framework — `game/content/missions.ts`, `docs/missions.md`
- residence, Local Places, merchants — `game/content/local-places.ts`,
  `game/content/merchants.ts`, `game/content/locations.ts`
- settlement, economy, and approved town direction — `docs/holo-hollow.md`
- balance and level curves — `game/config/balance.ts`

Where this file and shipped code disagree, **the code wins** and this file is
wrong and should be corrected.

## How to classify a fact

Every non-obvious fact carries **two independent tags**: one for whether
RuneSpace has decided it, and one for who may be told. They are separate
dimensions. A fact can be fully shipped and still be unsafe to publish
globally.

**Canon status — has RuneSpace decided this?**

| Tag | Meaning |
| --- | --- |
| `SHIPPED` | Established by content a player can actually reach in the current build. |
| `APPROVED — NOT SHIPPED` | Settled in a committed design doc, but no player can encounter it yet. |
| `UNKNOWN` | RuneSpace has never established it. Leave it blank; do not fill it in. |
| `UNRESOLVED` | Sources disagree, or the question is open and needs a product decision. |

**Visibility — who may be told?**

| Tag | Meaning |
| --- | --- |
| `PUBLIC-SAFE` | Safe to publish on a globally visible Wiki. Includes anything established by the mandatory Holo Hollow tutorial arc — see **The publishing test** below. |
| `SPOILER-SENSITIVE` | True, possibly shipped, but publishing it would materially damage an intended discovery. Usable in internal work and in later authored content; never in public copy. |
| `INTERNAL-ONLY` | Writers and agents only. Never public, and not to be leaked through implication or cross-link either. |

So a fact is written as, for example,
`SHIPPED / SPOILER-SENSITIVE` or `APPROVED — NOT SHIPPED / INTERNAL-ONLY`.

### The publishing test

The test for `PUBLIC-SAFE` is **not** "could a brand-new character know this
yet?" — that reading would hide the whole game. The test is:

> **Would publishing this materially damage an intended discovery?**

RuneSpace's mandatory opening arc **is** its tutorial and onboarding. The public
Wiki may describe the full mandatory path — **Walk It Off → Cut Your Teeth →
Waste Not → Hold It Together → Keep the Change → 10,000 Hours** — and the
durable world and character facts it establishes. Every player takes that route;
documenting it is a manual, not a spoiler.

So ordinary tutorial-era facts are `PUBLIC-SAFE` even though a fresh character
has not reached them yet: Mining, Refining and Welding; Wade taking the player
on as apprentice and teaching them to weld; Rusk Recovery and Wade coming to
work from his own yard; Practice Welding and the bench; and the ordinary
relationships, businesses, and world facts the mandatory Missions establish.

Keep protecting what is genuinely worth discovering:

- optional conversations whose value is in finding them in play;
- optional Missions and their outcomes, judged case by case;
- private motivations and secrets;
- emotionally significant backstory;
- unrevealed relationships and history;
- approved-but-unshipped future story;
- post-tutorial story and progression outcomes;
- anything whose early disclosure would undercut a later authored reveal.

Two rules that are still easy to get wrong:

- **Shipped does not automatically mean publishable.** Tansy's
  `Beyond Holo Hollow` topic is fully shipped and reachable and is still
  `SPOILER-SENSITIVE` — not because it is gated, but because it is optional
  character material and the emotional seed of her longer arc.
- **Gated does not automatically mean protected, either.** Do not strip a fact
  from public copy merely because a Mission stands in front of it. If it is on
  the mandatory path and revealing it damages nothing, publish it.
- **`UNKNOWN` is a valid, final answer.** Do not convert it into a fact because
  a bible field or a Work Order would read better filled in. If content needs
  an answer, that is a decision for Brandon, and it belongs in
  **Open canon questions** below.

## Source precedence

1. Shipped content and code (`game/content/`, `game/config/`) — highest.
2. Shipped player-facing text (public Updates, the public Wiki).
3. Committed design/normative docs (`docs/holo-hollow.md` and friends) — these
   establish *approved direction*, not shipped fact.
4. Nothing else. Chat history, session memory, and prior agent summaries are
   **not** canon and must never be cited here.

## Entry template

Each entry uses the fields below. Omit a field only when it genuinely has no
content; prefer writing `UNKNOWN` over silence, so a later writer can tell the
difference between "nobody decided" and "nobody wrote it down".

- **Stable identity** — NPC ID, display name, aliases, pronouns.
- **Visual identity** — the currently authored expression assets, any
  expression semantics that code or content states explicitly, and durable
  appearance facts where they are actually established. **Read the rule below
  before writing this field.**
- **Role / occupation**
- **Home / work / usual locations** — including progression-dependent placement.
- **Personality and values**
- **Voice** — vocabulary, cadence, humor, and what they would not say.
- **Relationships**
- **Player encounter chronology** — when the player meets them, and whether that
  encounter is guaranteed.
- **Mission / story involvement**
- **Work, business, and equipment context** — property later content may reference.
- **Knowledge** — what this person knows about the world, the player, and others.
- **Secrets and unrevealed canon**
- **Player-knowledge boundaries** — what the player knows at which point.
- **Public-Wiki-safe facts** — the subset a public article may draw on. This
  field is the *only* authorized input to a public character article.
- **Future hooks / approved direction**
- **Open canon questions**
- **Source references**

### The Visual identity field does not establish character

`EXPRESSION_IDS` is a deliberately generic shared vocabulary, and each NPC maps
it to whatever art has actually been drawn for them
(`game/config/foundations.ts`). The roster of expression files an NPC has today
is **the set drawn so far, and nothing more**.

So this field may record:

- the expression keys and asset paths currently authored for that NPC;
- expression semantics that code or content states **explicitly** — Mara's
  `firm` is the production example, defined in both `foundations.ts` and
  `npcs.ts` as composed and matter-of-fact rather than wary or displeased;
- durable appearance facts, where prose or approved art direction actually
  establishes one.

It must **not** treat a missing asset as a fact about the person. That an NPC
has no `smile` file does not establish that they never smile, are incapable of
warmth, or must not be written warmly; it establishes that nobody has drawn
that portrait yet. Absence of art is a production state, and `docs/art-cookbook.md`
plus `docs/holo-hollow.md` both record real art debt in this cast — treating a
gap as characterization would freeze an accident into canon, which #192
explicitly forbids.

**Voice and personality come from dialogue and approved narrative direction**,
never from reverse-engineering the portrait inventory. A future beat that needs
an expression nobody has drawn is an art request, not a canon violation.

---

## Wade Rusk

**Stable identity.** `wade_rusk` / "Wade Rusk". No aliases. He/him
(`SHIPPED / PUBLIC-SAFE` — self-introduction plus third-person reference
throughout `dialogue.ts` and the shipped Updates).

**Visual identity.** Currently authored expression assets: `neutral`
(`/npc-art/wade-neutral.png`), `concerned` (`wade-concerned.png`), `scowl`
(`wade-scowl.png`). `SHIPPED / PUBLIC-SAFE`. No durable appearance facts are
established in prose; the portraits are the only visual reference. Nothing
about this set constrains how Wade may be written — see **The Visual identity
field does not establish character**.

**Role / occupation.** Recovery, salvage, and field repairs, out of his own
yard, Rusk Recovery. His own summary, given verbatim on first meeting and
again over comms on the alternate route: *"Recovery, salvage, field repairs. If
something around here quits moving, I either make it move again or sell the
parts that still do."* `SHIPPED / PUBLIC-SAFE`.

He does not build. *"I don't build from scratch. I make what's already lying
around work again — or work as something else."* `SHIPPED / PUBLIC-SAFE`.

**Home / work / usual locations.** Authored one-time, Mission-derived move
(`npcs.ts` `relocation`): at the **Crash Site** until **Keep the Change** is
completed, at **Rusk Recovery** from then on. This is one person in two places
over time, never two Wades — see `docs/npc-conversations.md` for the resolution
rule. Rusk Recovery is on the northwest edge of Holo Hollow, one ordinary
walking edge from town, and has been visible on the map from the start of the
game. `SHIPPED / PUBLIC-SAFE`.

Where Wade *lives* is `UNKNOWN`. Nothing establishes that he sleeps at the
yard; do not imply it.

**Personality and values.** Judges people by whether they finish what they
started. Pays for work and refuses to make a moment of it. Withholds praise
almost entirely, and the withholding is affection, not coldness — his approval
arrives as a shorter sentence, not a warmer one (*"Took the job. Did the job.
That's the whole of it."*). He is sincerely aggrieved that the player's crash
cost him a salvage claim and he keeps saying so on purpose: *"No. I'm not going
to stop bringing that up."* `SHIPPED / PUBLIC-SAFE`.

Two lines carry his working ethic and should govern any future job he hands
out: *"People bring me things they can't afford to lose twice"*, and his refusal
to let an untrained apprentice touch client property.
`SHIPPED / PUBLIC-SAFE`.

**Voice.** Short declaratives. Sentence fragments. Dry, never cruel. Opens with
a flat acknowledgement (*"Hm."*, *"All right."*) rather than a greeting. States
a price or a quantity plainly and moves on. Deflects sentiment mid-sentence
(*"Don't make a ceremony out of it."*). Will not use an exclamation mark, will
not gush, will not explain a feeling, and will not call the player by an
affectionate name.

**Relationships.**

- **Tansy Rusk** — his **niece**. Established in his first scene: *"My niece
  Tansy's working The Jag."* `SHIPPED / PUBLIC-SAFE`.
- **Tansy, the deeper history** — Wade took Tansy to the movies every Friday
  after her parents died, continuing a tradition her parents had started with
  her. `APPROVED — NOT SHIPPED / INTERNAL-ONLY`. This is the single most
  spoiler-bearing fact in RuneSpace's current canon. `docs/holo-hollow.md`
  requires the *recurring* movie tradition to be established before its
  emotional history is revealed, so that the detail lands rather than being an
  exposition dump. Nothing — not a Work Order, not a wiki page, not a throwaway
  line — may reveal it early.
- **The player** — takes them on as **apprentice** after Hold It Together,
  without asking. `SHIPPED / PUBLIC-SAFE`. He is quietly proud of them, which
  Tansy says out loud and he never does. `SHIPPED / PUBLIC-SAFE`.
- **Bix Weller** — roughly the same age; they grew up together and likely went
  to school together, which gives their present-day familiarity a long history.
  `APPROVED — NOT SHIPPED / PUBLIC-SAFE` in outline. No shipped line puts the
  two men in a scene together, so content must not yet write their banter as
  established.
- **Mara Kells** — knows him well enough to warn the player fairly: *"Wade can
  be demanding. But pay attention, and you will learn a lot from him."*
  `SHIPPED / PUBLIC-SAFE`.

**Player encounter chronology.** **Guaranteed, and first.** He offers Walk It
Off at the Crash Site; a player who walks to The Jag first instead still meets
him, because he introduces himself over comms inside Tansy's scene. Keep the
Change and 10,000 Hours both require him again. There is no route through the
current game that avoids Wade.

**Mission / story involvement.** Offers **Walk It Off**; takes the **Waste Not**
turn-in; offers and turns in **Hold It Together**; offers **Keep the Change**
(handing over 24 Credits on acceptance); offers and turns in **10,000 Hours**
(handing over six Scrap Metal on acceptance, paying 50 Credits on completion).
Replayable topic: **Recovery work**, always available. Structure and exact
values live in `game/content/missions.ts`.

**Work, business, and equipment context.** The richest inventory of any NPC,
and the most useful for later Work Orders. All `SHIPPED / PUBLIC-SAFE` unless
noted:

- **Rusk Recovery** itself — *"salvaged machinery and stripped components racked
  in rows, damaged speeders waiting their turn, and a welding bench somebody
  actually works at. Messy, and organized by somebody who knows exactly where
  everything is."* (`locations.ts`).
- **The gate** — *"Everything this valley gives up on comes through that gate
  first."*
- **The workbench** — a real workbench, opened to the player by 10,000 Hours'
  acceptance; Practice Welding happens here.
- **The Work Orders terminal** — *"that terminal in the corner is where the
  paying jobs come in."* Revealed by 10,000 Hours' completion. Empty in the
  current build.
- **Scrap Metal stock** — sells at 2 Credits a piece, *"same as he would charge
  anybody"*. Deliberately unlimited; he does **not** buy Slag back, because Bix
  already does.
- **A crate he keeps Power Cells in** — *"I've got none in the crate. I checked
  this morning."* Small, but it is an authored possession.
- **Comms** — he takes calls from Tansy at the seam and from the player's
  position.

**Knowledge.** Knows what a wreck is worth and which half of it still is. Knows
Bix's retail price for Power Cells (8 Credits) without being told. Knows what
Tansy is working on and where. Knows, after Keep the Change, that his apprentice
can be trusted with an errand and with money. Does **not** demonstrably know the
Annex's contract history — that is Bix's knowledge, and Wade never mentions it.

**Secrets and unrevealed canon.** The Friday movie tradition and Tansy's
parents' deaths (above). `APPROVED — NOT SHIPPED / INTERNAL-ONLY`.

**Player-knowledge boundaries.**

- From minute one: his name, trade, temperament, and grievance.
- After Keep the Change: where his business actually is, and that he has one.
- After 10,000 Hours: the bench, the Scrap trade, and that paying client work
  exists and is not yet theirs.
- Never yet: anything about Tansy's parents, the movie tradition, his age, his
  own history, or his home.

**Public-Wiki-safe facts.** All of the following are established by the
mandatory tutorial arc and are safe to publish: his name; that he runs recovery,
salvage and field repairs; that he is Tansy's uncle; that he is found at the
Crash Site to begin with and works from Rusk Recovery afterwards; that he takes
the player on as his apprentice; that he teaches Welding; the yard itself, its
workbench and Practice Welding; and that he sells Scrap Metal there. His
manner — blunt, dry, hard to impress, and openly unimpressed about the crash —
is equally publishable, and is most of what makes a page about him worth
reading.

Withhold: Tansy's parents, the Friday movie tradition, his age, his home, and
anything about future client work beyond what the game already says out loud.

**Future hooks / approved direction.** He is the client-work gateway: the Work
Orders terminal is his, in his yard, and the first paying jobs arrive through
him. `APPROVED — NOT SHIPPED`.

**Open canon questions.** His age (no number established); where he lives;
whether he has family besides Tansy; the coolant-manifold-and-serving-spoon
anecdote Tansy promises but never tells (`UNKNOWN` — the *tease* is shipped, the
story is not written). Whether a Work Order may come from Wade himself, given
that he is the person posting the board — see **Open canon questions** at the
end of this file.

Whether a Work Order may come from Wade himself is **settled: no**, for the
initial pool. It is a framing decision — he owns the shop the work arrives
through — and not a statement that he can never be a repair client later.

Note that the Work Orders terminal's provenance is **not** an open question.
`docs/holo-hollow.md` records that tourism-era ticket/information infrastructure
*may* later support a contract board — an explicitly speculative possibility,
never an assertion that RuneSpace's Work Orders terminal must reuse it. The
shipped terminal is authored independently as scenery in Wade's yard
(`game/content/rusk-recovery.ts`, `features/practice/WorkOrdersTerminal.tsx`).
The two statements do not conflict, and no reconciliation should be invented.

**Source references.** `game/content/npcs.ts`; `game/content/dialogue.ts`
(`wadeOffer`, `wadeKeepTheChangeOffer`, `wadeTenThousandHours*`,
`wadeRecoveryWorkTopic`, `tansyKeepTheChangeCompletion`);
`game/content/missions.ts`; `game/content/locations.ts` (Rusk Recovery);
`game/content/merchants.ts`; `game/content/rusk-recovery.ts`;
`docs/holo-hollow.md` (Holo Drive-In and Tansy's longer arc);
`features/public-site/public-updates.ts` (`ten-thousand-hours`).

---

## Tansy Rusk

**Stable identity.** `tansy_rusk` / "Tansy Rusk". No aliases. She/her
(`SHIPPED / PUBLIC-SAFE` — Wade's *"My niece Tansy... She knows ferrite"*, and
consistent reference throughout).

**Visual identity.** Currently authored expression assets: `neutral`
(`/npc-art/tansy-neutral.png`), `concerned` (`tansy-concerned.png`), `smile`
(`tansy-smile.png`). `SHIPPED / PUBLIC-SAFE`. No durable appearance facts are
established in prose. Her warmth is established by her dialogue, not by which
files exist.

**Role / occupation.** Field mechanic and miner. She works the ferrite seam at
**The Jag** and builds working tools out of salvage.
`SHIPPED / PUBLIC-SAFE`.

**Home / work / usual locations.** The Jag, always. She has no relocation entry
and no Local Place — she is simply present at her World Location. Where she
lives is `UNKNOWN`; The Jag is a seam, not a settlement, and nothing says she
sleeps there.

**Personality and values.** Generous with knowledge and blunt about safety.
Teaches by handing someone a tool and telling them the one thing that will hurt
them. Deflects her own competence (*"I threw it together from parts I had lying
around"*) while being demonstrably the best engineer in the current cast — she
built the Salvage Cutter the entire early game runs on. Reads Wade fluently and
translates him for people who cannot (*"That was him being proud, in case it
went past you."*). `SHIPPED / PUBLIC-SAFE`.

**Voice.** Warm, quick, self-deprecating. Full sentences, unlike Wade. Jokes
land as safety instructions and safety instructions land as jokes: *"Keep your
finger out of the moving bits and try not to point the hot end at anything
you're emotionally attached to."* Uses *"Yep."*, *"Hold on."*, *"Anyway."* She
will apologize for a clumsy question. She would not be cruel, would not pull
rank, and would not pretend a thing is safe.

**Relationships.**

- **Wade Rusk** — her **uncle**. `SHIPPED / PUBLIC-SAFE`.
- **Wade, the deeper history** — her parents are dead, and Wade took her to the
  movies every Friday afterwards, continuing a tradition her parents had started.
  `APPROVED — NOT SHIPPED / INTERNAL-ONLY`.
- **The player** — takes an immediate liking to them, equips them, teaches them
  Mining and the Refining loop, and treats them as the one person around who has
  actually been somewhere else. `SHIPPED`; the last part is
  `SPOILER-SENSITIVE` (see below).
- **Renn Calder** — `APPROVED — NOT SHIPPED / INTERNAL-ONLY`: Renn would tell
  younger residents *such as Tansy* not to sacrifice their whole lives to the
  town (`docs/holo-hollow.md`). No shipped content puts them in a scene together
  or establishes that they know each other. Do not write them as acquainted yet.

**Player encounter chronology.** **Guaranteed, and second at the latest.** Walk
It Off's turn-in is Tansy at The Jag, by either offer route. Cut Your Teeth and
Keep the Change both return to her.

**Mission / story involvement.** Alternate offer route for **Walk It Off** and
its turn-in (grants the Salvage Cutter); offers and turns in **Cut Your Teeth**;
contextual dialogue during **Waste Not** and **Hold It Together**; takes the
**Keep the Change** turn-in and makes the comms call that hands the player off
to Wade's yard. Replayable topics: **Mining** (always) and **Beyond Holo
Hollow** (after Hold It Together).

**Work, business, and equipment context.** All `SHIPPED / PUBLIC-SAFE`:

- **The Salvage Cutter** — she built it from spares: *"Nothing matches, it's not
  very fast, and half of it probably violates a regulation Wade already hates,
  but it'll cut shale."* It runs on Power Cells and is dead weight without them.
- **The Jag's workings** — *"It's a seam, not a mine. Big difference."* Carved
  out of the hardpan by whoever got here first.
- She runs out of Power Cells mid-shift and would rather not lose an afternoon
  walking back for them — the premise of Keep the Change.

`APPROVED — NOT SHIPPED` — the authored Work Order `tansy_cutter_housing`
introduces **one** further possession: a separate working cutter of her own,
whose housing is built with the same mismatched-spares approach as her
established style. Note carefully that the Salvage Cutter in shipped dialogue is
the one she **builds and gives to the player**, and shipped content does not
establish a second one; this is new canon, not a restatement. Do not expand it
with a model name, age, history, or a wider inventory of her tools, and do not
publish it as current fact while Work Orders are unimplemented
(`docs/work-orders.md`).

**Knowledge.** Ferrite, shale, cutting, and improvised repair. Knows the hopper
at the Abandoned Processing Yard and how Refining behaves. Knows Wade well
enough to predict him. Knows the Cutter's charge economy. Knows Bix sells Cells
at 8 and the Annex gives out 5 a day.

**Secrets and unrevealed canon.** `SHIPPED / SPOILER-SENSITIVE` — the whole of
the **Beyond Holo Hollow** topic: she wants to see other stations and planets;
she feels responsible for Wade and for a town running out of people who can keep
the old equipment working; she knows Wade never asked her to stay and that the
obligation is self-imposed; she cannot yet want something for herself without
feeling she is taking it from someone else. She also knows the player once lived
the travelling life she wants and was robbed of the memories.

`APPROVED — NOT SHIPPED / INTERNAL-ONLY` — restoring the Holo Drive-In projector
is tied to this arc: seeing a credible future for the town is part of what
eventually lets her feel all right about leaving, potentially travelling with
the player.

**Player-knowledge boundaries.**

- From the first meeting: her name, her trade, that she is Wade's niece, that
  she built the Cutter.
- After Hold It Together, *only if the player opens an optional topic*:
  everything in the paragraph above.
- Never yet: her parents, the movie tradition, the projector arc, her age.

**Public-Wiki-safe facts.** Established by the mandatory arc and safe to
publish: her name; that she is a field mechanic and miner; that she is Wade's
niece; that she is based at The Jag; that she built the Salvage Cutter out of
spare parts; that she teaches the player Mining and the Refining loop; and her
manner — warm, funny, and cheerfully safety-first.

Withhold **all** of the `Beyond Holo Hollow` material: wanting to leave, her
sense of obligation to Wade and the town, the projector arc, and the player's
own lost history. Not because it is gated — plenty of gated tutorial facts are
publishable — but because it is optional character material whose whole value is
finding it in play, and it seeds her longer arc.

**Future hooks / approved direction.** She carries RuneSpace's first long
character arc. Later content should establish the recurring Wade/Tansy movie
tradition *before* its emotional history, per `docs/holo-hollow.md`.

**Open canon questions.** Her age; where she lives; her parents' names and how
they died; whether she and Renn know each other; the Wade-and-the-serving-spoon
story she promises to tell.

**Source references.** `game/content/npcs.ts`; `game/content/dialogue.ts`
(`tansyBeforeMission`, `tansyCompletion`, `tansyCutYourTeeth*`,
`tansyKeepTheChangeCompletion`, `tansyMiningTopic`,
`tansyBeyondHoloHollowTopic`, `tansyPostKeepTheChange`);
`game/content/missions.ts`; `docs/npc-conversations.md` (Beyond Holo Hollow);
`docs/holo-hollow.md` (Holo Drive-In and Tansy's longer arc).

---

## Bix Weller

**Stable identity.** `bix_weller` / "Bix Weller". No aliases. He/him
(`SHIPPED / PUBLIC-SAFE` — Wade's *"He's the one who keeps Cells on a shelf"*,
Mara's topic, and shipped Update copy).

**Visual identity.** Currently authored expression assets, whose filenames
record the intended reading of each generic key for him: `neutral` =
`bix-neutral-dry.png`, `amused` = `bix-amused-knowing.png`, `concerned` =
`bix-skeptical-concerned.png`. `SHIPPED / PUBLIC-SAFE`. Those readings are
authored asset names, not inferences. No durable appearance facts are
established in prose.

**Role / occupation.** Runs **Holo Hollow Souvenirs + Mining Supplies**, the
town's shop. `SHIPPED / PUBLIC-SAFE`.

The shop's identity is the character: the original *Holo Hollow Souvenirs* sign
still hangs, with a rougher *+ Mining Supplies* board bolted on underneath. Bix
still thinks of it as a souvenir shop that happens to sell mining supplies. His
own summary: *"Holo Hollow Souvenirs. And Mining Supplies. That part came
later."*, ending on *"Mining gear does. That doesn't make this a mining store."*
`SHIPPED / PUBLIC-SAFE`.

That this is **mild denial and identity preservation, not a bit he is performing
for the player**, is `APPROVED — NOT SHIPPED / INTERNAL-ONLY` framing from
`docs/holo-hollow.md`. Write him sincere. He is not winking.

**Home / work / usual locations.** Resident of the `holo_hollow_souvenirs` Local
Place inside Holo Hollow. He is found in his shop and nowhere else — never
standing in the street. Where he lives is `UNKNOWN`.

**Personality and values.** Dry, observant, fundamentally decent. Will make
money from the player and will not make money from the player being stupid: he
volunteers, unprompted and against his own interest, that the Annex gives out
five free Cells a day before the player spends Wade's money on his shelf.
`SHIPPED / PUBLIC-SAFE`. Mara's summary is the character in one line: *"He's
decent. He'll tell you the truth even when a lie would make him money."*

**Voice.** Very short lines, often one clause, stacked into a rhythm that lands
a deadpan punchline at the end (*"Need another one? Eight Credits. Got extras?
I'll give you three Credits each." / "That's called a store."*). Corrects
himself mid-thought. Says *"kid"*. Uses clipped dialect occasionally
(*"Tansy's waitin'."*). He would not be unkind, would not oversell, and would
not pretend the souvenirs are moving.

**Relationships.**

- **Mara Kells** — lifelong friends, *"since we were kids running between these
  two buildings."* `SHIPPED / PUBLIC-SAFE`. Her affectionate verdict — she loves
  him dearly and thinks he is a dingdong for still waiting on tourism — is
  shipped but reachable only inside HH B&B; treat the *friendship* as public and
  the *verdict* as `SHIPPED / SPOILER-SENSITIVE` flavor better discovered in
  play.
- **Wade Rusk** — `APPROVED — NOT SHIPPED`: roughly the same age, grew up
  together, likely schooled together. Bix's shipped lines about Wade are
  familiar and teasing (*"No delivery tip. That's Wade."*), which is consistent,
  but the shared history itself is not yet shipped.
- **His parents** — owned the shop through the tourism era and filled it with
  *"shirts, mugs, little projector toys."* `SHIPPED / PUBLIC-SAFE`. Whether they
  are alive, and their names, are `UNKNOWN`.
- **The player** — friendly, amused by their situation, and the first person in
  town to treat them as somebody who now works here.

**Player encounter chronology.** **Guaranteed.** Keep the Change carries a hard
`npc_conversation` requirement on Bix — the player must complete his authored
introduction, whether or not they buy anything. He cannot be skipped.

**Mission / story involvement.** Owns the required introduction scene in **Keep
the Change**, which is also where Mara is introduced. He offers no Mission of
his own. Replayable topics: **The shop**, **Power Cells**, **Holo Hollow**, all
always available. His **Trade** action is deliberately separate from **Talk**.

**Work, business, and equipment context.** All `SHIPPED / PUBLIC-SAFE`:

- **The shop itself** — shelves of tourist-era trinkets beside the mining
  supplies that actually sell.
- **The signage** — the original painted *Holo Hollow Souvenirs* sign, and the
  rough *+ Mining Supplies* board bolted on beneath it.
- **Stock and pricing** — sells Power Cells at 8 Credits; buys Power Cells at 3,
  Refined Ferrite at 10, Ferrite Shale at 2, Slag at 1. One line deep on
  purpose. Authoritative values live in `game/content/merchants.ts`.
- **A standing souvenir inventory that does not move** — including, per Mara, a
  whole shelf of souvenir mugs.
- **Freight economics** — *"Getting anything out here costs money before I even
  put it on a shelf."* This is the canon reason his margins look the way they
  do, and the most useful hook for any future shop-equipment content.

**Knowledge.** The best-informed NPC about the town's institutions. Knows the
Annex's full history: Settled Systems required an emergency power depot when
projector nights filled every room, **DeWhat?** won the contract, the tourists
left and the contract did not, and it issues five Cells per person per local
day. Knows why the limit exists. Knows the town's tourism history first-hand —
projector nights, full rooms, kids spending every Credit before their parents
got them back in the speeder — and why it ended: the new releases stopped working
here. `SHIPPED / PUBLIC-SAFE`.

**Secrets and unrevealed canon.** None established. His is the rare entry with
no INTERNAL-ONLY row, and that is itself useful: Bix is safe to write about.

**Player-knowledge boundaries.** Everything above is available from the Keep the
Change introduction and his three always-on topics. There is no gated Bix
content.

**Public-Wiki-safe facts.** Bix is the most straightforwardly publishable
character in the cast: everything shipped about him is either mandatory-arc
content or an always-available topic, and none of it is authored as a later
reveal. Safe to publish: his name; that he runs Holo Hollow Souvenirs + Mining
Supplies; that his parents ran it through the tourism years; that he still
stocks souvenirs that do not sell; what he buys and sells; the Annex's history
and why free and paid Power Cells coexist; and his dry, honest, good-company
manner.

Withhold only the `APPROVED — NOT SHIPPED` material: his age, and the shared
childhood with Wade.

**Future hooks / approved direction.** He believes the town may yet recover its
tourism identity — the hopeful corner of the Bix / Mara / Renn triangle
(`docs/holo-hollow.md`). Any projector-restoration content will matter to him
most.

**Open canon questions.** His age (only "roughly Wade's age"); his parents'
names and whether they are living; where he lives; whether he has family of his
own.

**Source references.** `game/content/npcs.ts`; `game/content/local-places.ts`;
`game/content/merchants.ts`; `game/content/dialogue.ts`
(`bixKeepTheChangeIntroduction`, `bixTheShopTopic`, `bixPowerCellsTopic`,
`bixHoloHollowTopic`, `maraBixTopic`); `game/content/missions.ts` (Keep the
Change); `docs/holo-hollow.md` (First residents and businesses);
`features/public-site/public-updates.ts` (`keep-the-change`,
`holo-hollow-opens-for-business`).

---

## Renn Calder

**Stable identity.** `renn_calder` / "Renn Calder". No aliases. **He/him**
(`SHIPPED / PUBLIC-SAFE`). The pronoun is attested in `docs/holo-hollow.md`'s
Out of the Weather section — *"He is complaining about a neglected thing, not
handing out work — he never asks the player to fix it"* — with no contradicting
source anywhere in the repo. Treat it as settled; no further decision is needed.

**Visual identity.** Currently authored expression assets, whose filenames
record the intended reading of each key for him: `neutral` =
`renn-neutral-tired.png`, `sardonic` = `renn-dry-sardonic.png`, `guarded` =
`renn-serious-guarded.png`. `SHIPPED / PUBLIC-SAFE`. No durable appearance
facts are established in prose.

**Role / occupation.** Ferrite miner. `SHIPPED / PUBLIC-SAFE`. Which seam or
crew he works is `UNKNOWN` — he is never shown at work, and The Jag is
established as Tansy's ground.

**Home / work / usual locations.** Resident of the
`holo_hollow_assistance_center` Local Place — the **Holo Hollow Community
Assistance Center**, the former Visitor Center, open from the start of the game.
He is found there and nowhere else. Where he lives is `UNKNOWN`.

Whether he is at the Assistance Center as somebody who **needs** it or somebody
who **helps run** it is deliberately unstated. His line *"People like to talk
about needing this place like it's embarrassing. It isn't. Needing help isn't
the part that should embarrass anybody"* leans toward the former without
committing. `UNRESOLVED / INTERNAL-ONLY` — this reads as authorial restraint
rather than an oversight. **Do not resolve it in content**, and do not let a
Work Order or a wiki article imply either answer.

**Personality and values.** Tired, clear-eyed, and quietly principled. The
youngest established resident and the one with the least patience for the town's
self-mythology. He is not bitter about people, only about arithmetic: *"Every
year somebody says demand's about to turn around. Every year we get another
reason to wait one more year."* He notices small things that make other
people's mornings worse, and says so without expecting anyone to act.
`SHIPPED / PUBLIC-SAFE`.

His defining move is the quiet correction at the end of a paragraph —
*"Sometimes staying is loyalty. Sometimes it's just being afraid to go. Those
aren't the same thing."* He is the character who refuses to let a comfortable
word stand in for a true one. `SHIPPED / PUBLIC-SAFE`.

**Voice.** Flat, short, unhurried. Fragments. Understatement as default
(*"Still standing. Still leaking."*). Never performs cheer, never pitches, never
asks for anything. Sarcasm is dry and aimed at situations, not people. He would
not beg, would not guilt anyone, and would not claim credit — when the player
fixes the Crew Stop his whole acknowledgement is *"That was you."*

**Relationships.**

- **The town** — knows everybody, knows which roof leaks, knows who shows up at
  two in the morning when something breaks. That knowledge is why leaving is
  hard, not why staying is easy. `SHIPPED / PUBLIC-SAFE`.
- **The mining crews** — not his crew, exactly, but his people. He speaks for
  them about the Crew Stop and reports how they react afterwards: *"They just
  don't mind you now. That's worth more here than it sounds."*
  `SHIPPED / PUBLIC-SAFE`.
- **Tansy Rusk** — `APPROVED — NOT SHIPPED / INTERNAL-ONLY`: he would tell
  younger residents such as Tansy not to sacrifice their whole lives to the town
  (`docs/holo-hollow.md`). **No shipped content establishes that they have ever
  met.** Do not write them as acquainted.
- **Bix / Mara** — no established relationship in either direction. `UNKNOWN`.

**Player encounter chronology.** **NOT guaranteed.** The Assistance Center is
open from the start, but nothing requires the player to enter it, and **Out of
the Weather is optional** — it hangs off Hold It Together, is never a
prerequisite for anything, names no continuation, and ignoring it forever costs
the player nothing. A player can complete the entire current main story, reach
Rusk Recovery, and finish 10,000 Hours without ever having met Renn.

This constrains **copy, not eligibility**. Renn can be a Work Order client like
anybody else in town; what his job must not do is assume the player knows him,
or lean on the Crew Stop and the Crew Hauler, which would foreground an optional
Mission the player may never have found. See **Encounter chronology does not
decide who can be a Work Order client**.

**Mission / story involvement.** Offers and turns in **Out of the Weather**,
RuneSpace's first deliberately optional side Mission and its first permanent
player-made improvement to the world. The accept control is **`PITCH IN`** — the
player deciding to involve themselves, since Renn never actually asks. On
completion he explains the Crew Hauler. Replayable topics: **The Assistance
Center**, **Ferrite**, **Life here**, all always available.

**Work, business, and equipment context.** Renn is, deliberately, the resident
with the least *property* — his shipped material is about things nobody owns.
Established:

- **The Crew Stop** — *"Everybody uses it, nobody owns it."* Explicitly not his.
- **The shift hauler** — belongs to the crews, not the town and not Renn. Five
  Credits, outbound only, no room coming back with it loaded.
- **The Assistance Center's fixtures** — forms, notices, stacked ration crates.
  Municipal, not his.

Shipped content establishes no tools, vehicle, home, or equipment of his own.
That is an absence of evidence, not an established fact of poverty — **do not
write him as owning nothing**; simply do not give him possessions canon has not.

`APPROVED — NOT SHIPPED` — the authored Work Order `renn_carry_frame` introduces
exactly one: an ore carry frame used in his mining work. His occupation made that
plausible, but plausible was never established, and this job is what establishes
it. Nothing further follows from it — no other tools, no vehicle, no home, no
circumstances — and it is not publishable as current fact while Work Orders are
unimplemented (`docs/work-orders.md`).

**Knowledge.** The town's actual condition, as opposed to its story about
itself. The Assistance Center's history as the Visitor Center. Ferrite's market
and the yearly cycle of promised recovery. The crews' routines and what they
notice.

**Secrets and unrevealed canon.** No secrets established. The remaining
material is `APPROVED — NOT SHIPPED`, demographic and structural rather than
confidential: he is roughly **late 20s to early 30s**, grew up after the tourism
boom was already mostly gone, and exists to supply the third view of Holo
Hollow — Bix says the old town can come back, Mara says stop waiting and make
this one work, Renn says neither version has much future, so leave while you
still can. It stays out of public copy because it is **unshipped design**, not
because it is a secret; if it ships, it becomes publishable.

**Player-knowledge boundaries.** Everything shipped about Renn is available from
his three always-on topics and the optional Mission — but **only to a player who
walks into the Assistance Center**. A player who never does knows he exists only
from the public Wiki.

**Public-Wiki-safe facts.** Safe to publish: his name; that he is a Ferrite
miner; that he is found at the Community Assistance Center; that the Center is
the old Visitor Center, now handling local assistance and rations; and his
manner — dry, tired, straight-talking, and clear-eyed about the town.

**Out of the Weather, evaluated separately.** It is optional, so it does not
inherit the tutorial arc's publishability. Judged on its own evidence it is
nonetheless `SHIPPED / PUBLIC-SAFE` **as a matter of record**: the shipped
`out-of-the-weather` Update names Renn as offering it, and the existing
`holo-hollow` Wiki article already documents the Crew Stop repair and the ride
that follows. Nothing on a character page could leak it — it is published.

That said, publishing it and *foregrounding* it are different choices. The value
of this Mission is largely in Renn mentioning a neglected thing and the player
deciding to involve themselves, so **a character page should not lead with it,
and should not narrate its outcome.** Omitting it entirely is a legitimate
editorial call for Phase 4. This is an editorial preference, not a visibility
restriction — do not record it as a spoiler.

Withhold: his age range (unshipped design), and anything about his own
circumstances, home, family, or standing at the Assistance Center, none of which
canon has established.

**Future hooks / approved direction.** He is the dissenting voice in the town's
argument with itself, and that argument is the settlement's core theme
(`docs/holo-hollow.md`). Out of the Weather establishes the pattern intended for
later restoration work, including the projector arc: optional content that
permanently improves the world without becoming a prerequisite.

**Open canon questions.** Whether he receives or provides assistance at the
Center (above, deliberately open); where he lives; which seam or crew he works;
family; whether he and Tansy have met.

**Source references.** `game/content/npcs.ts`; `game/content/local-places.ts`;
`game/content/missions.ts` (`OUT_OF_THE_WEATHER`, `actionLabel: "PITCH IN"`);
`game/content/dialogue.ts` (`rennOutOfTheWeather*`, `rennAssistanceCenterTopic`,
`rennFerriteTopic`, `rennLifeHereTopic`, `rennPostOutOfTheWeather`);
`game/content/repair-targets.ts`; `docs/holo-hollow.md` (First residents; Out of
the Weather); `docs/missions.md`;
`features/public-site/public-updates.ts` (`out-of-the-weather`).

---

## Mara Kells

**Stable identity.** `mara_kells` / "Mara Kells". No aliases. She/her
(`SHIPPED / PUBLIC-SAFE`).

**Visual identity.** Currently authored expression assets: `neutral` =
`mara-neutral-pragmatic.png`, `amused` = `mara-warm-wry.png`, `firm` =
`mara-firm-no-nonsense.png`. `SHIPPED / PUBLIC-SAFE`.

`firm` is the one expression key in the cast with **explicitly authored
semantics**: both `game/config/foundations.ts` and `game/content/npcs.ts` define
it as composed and matter-of-fact rather than wary (`guarded`) or displeased
(`scowl`), added for her set in #170. Use `firm` for her directness because that
is what the key was authored to mean — not because any other expression is
forbidden to her. No durable appearance facts are established in prose.

**Role / occupation.** Owns and runs **HH B&B**, the town's working inn.
`SHIPPED / PUBLIC-SAFE`.

**Home / work / usual locations.** Resident of the `hh_bnb` Local Place inside
Holo Hollow. HH B&B is **visible from the start but locked** until Keep the
Change completes, with the in-world reason *"Rooms here are held for locals and
regular working crews, not outside guests."* Access derives from the Mission
record itself, not a separate flag. Mara therefore has one guaranteed
appearance *outside* her own place — as an authored guest speaker in Bix's shop
during Keep the Change — and is otherwise found only at the B&B.
`SHIPPED / PUBLIC-SAFE`.

Whether she lives at the B&B is `UNKNOWN`. It is a plausible inference and
exactly the kind of blank that must not be filled in.

**Personality and values.** The pragmatist. Her whole characterization is one
decision made a long time ago and never regretted: the tourists stopped coming,
the rooms did not stop existing, so she stopped waiting. *"It isn't the business
my parents built. It's the one this town actually needed."*
`SHIPPED / PUBLIC-SAFE`.

Warm first, firm second, in that order and usually in the same conversation. She
teases, then tells you what to actually go and do: *"Get Tansy what she needs
first. She's out at The Jag with a dead Cutter while we're standing here
yapping."* She values work over sentiment and people over nostalgia, and she is
the counterweight to Bix without ever being unkind about him.

**Voice.** Conversational and full-sentenced, with a swing from affectionate to
brisk. Opens socially (*"Morning, Bix. How's business?"*). Teases the player
warmly (*"Ahh, you lucky bastard, you."*) — the only established profanity in
the current cast, and deliberate. Lands a plain verdict and then undercuts it
(*"I love him dearly. He's a dingdong. Don't tell him I said the first part."*).
She would not moan about the town, would not romanticize the tourism years, and
would not be sentimental about the building.

**Relationships.**

- **Bix Weller** — lifelong friends, *"since we were kids running between these
  two buildings."* She loves him and finds his tourism optimism exasperating.
  `SHIPPED`; the friendship is `PUBLIC-SAFE`, the affectionate verdict is
  `SPOILER-SENSITIVE` (reachable only inside the B&B, and better found in play).
- **Wade Rusk** — knows him well enough to give the player a fair and accurate
  warning about working for him. `SHIPPED / PUBLIC-SAFE`.
- **Her parents** — ran the bed-and-breakfast for visiting families during the
  tourism years. `SHIPPED / PUBLIC-SAFE`. Names, and whether they are living,
  are `UNKNOWN`.
- **The player** — decides they count as somebody who works here, and opens the
  B&B to them on that basis. *"Maybe you're not a tourist anymore."*
  `SHIPPED / PUBLIC-SAFE`.

**Player encounter chronology.** **Met, guaranteed — but possibly never
visited.** She speaks inside Bix's required Keep the Change introduction, so
every player has met her by that Mission's completion. But entering HH B&B and
hearing either of her topics is entirely optional. Content must assume the
player knows her face and her name, and must **not** assume they have ever been
inside her inn. Her Bix-shop appearance is a one-time authored beat and is not
replayable afterwards.

**Mission / story involvement.** No Mission of her own. She appears as an
authored guest speaker inside `bixKeepTheChangeIntroduction` — not a second
resident of the shop — and HH B&B unlocks on that Mission's completion.
Replayable topics: **The B&B** and **Bix**, both always available, gated only by
the Local Place's own access.

**Work, business, and equipment context.** `SHIPPED / PUBLIC-SAFE`:

- **HH B&B** — a family bed-and-breakfast from the tourism years, now the town's
  working inn for miners, haulers, contractors, and anybody working a long
  stretch out here. Hand-lettered sign.
- **The rooms and their contents** — *"Every room decorated for families who
  drove out to watch a projector show."* The décor did not change with the
  clientele. *"Same beds. Fewer complaints about the pillows."* This is the most
  specific inventory of household equipment in the current canon.

**Knowledge.** The town's working population — who is staying, for how long, and
on what job. Bix, thoroughly. Wade's reputation as an employer. The tourism
years first-hand.

**Secrets and unrevealed canon.** None established.

**Player-knowledge boundaries.**

- After the Keep the Change scene: her name, that she owns the B&B, that she
  knows Bix and Wade, and that the inn is for people who work here.
- Only if the player goes in: the B&B's family history and her verdict on Bix.
- Never established: her age, her family beyond her parents, where she lives.

**Public-Wiki-safe facts.** Safe to publish: her name; that she owns HH B&B;
that the family business became the town's working inn when tourism ended; that
the rooms are for locals and working crews; that she is a long-standing friend
of Bix; and her warm, direct, practical manner. That she becomes part of the
player's Holo Hollow during the tutorial is **not** a spoiler — she is
introduced on the mandatory path, and the B&B opening to the player is already
published in a shipped Update and the existing `holo-hollow` article.

An article need not narrate exact Mission chronology unless doing so genuinely
helps the page; "you will meet her in town, and the B&B opens to you once you
are working here" carries it without a walkthrough.

Withhold: her affectionate verdict on Bix from her own optional topic (worth
finding in play), her age, where she lives, and her family beyond the fact that
her parents ran the business.

**Future hooks / approved direction.** `APPROVED — NOT SHIPPED`: HH B&B is the
intended long-term home for rest/healing, food, lodging, travellers, rumours,
and Mission encounters — none of which should be built before gameplay creates a
real need. She is the deliberate pragmatic counterpoint to Bix's nostalgia.

**Open canon questions.** Her age; whether she lives at the B&B; her parents'
names and whether they are living; whether she has family of her own; whether
the B&B has any staff besides her.

**Source references.** `game/content/npcs.ts`; `game/content/local-places.ts`
(`hh_bnb` access rule); `game/content/dialogue.ts`
(`bixKeepTheChangeIntroduction`, `maraTheBnbTopic`, `maraBixTopic`);
`game/content/conversation-topics.ts`; `docs/holo-hollow.md` (First residents;
Keep the Change); `docs/npc-conversations.md`;
`features/public-site/public-updates.ts` (`keep-the-change`).

---

## Named non-person entities

Not NPCs, but named canon that character writing leans on. Recorded here so
nobody invents a second version of them.

- **DeWhat?** — the contractor that won the Settled Systems emergency-power
  contract and installed the automated Annex. The trailing question mark is part
  of the name. `SHIPPED / PUBLIC-SAFE`.
- **Settled Systems** / **S.S.A. — Settled Systems Authority** — the broad
  federal-ish authority that required the emergency-power depot during the
  tourism years. Bix names "Settled Systems" in shipped dialogue; the full
  "Settled Systems Authority" expansion is `APPROVED — NOT SHIPPED`
  (`docs/holo-hollow.md`). A narrower extraction/resource regulator may exist
  later and **its name is not yet canon** — do not coin one.
  `docs/holo-hollow.md` also requires that Ferrite regulation support legitimate
  disagreement: no cartoonish "space EPA", and no assumption that every local
  uses the same illegal workaround.
- **Mykea** — the brand on the `Mykea Schleppraum 8`, the starter container
  (8 slots). `SHIPPED / PUBLIC-SAFE`. Nothing else about the company is
  established.
- **The Holo Drive-In / projector complex** — the town's former tourist draw, a
  separate nearby World Location that is **not implemented**. Its obsolescence
  drives the whole settlement's decline. `APPROVED — NOT SHIPPED`; its role in
  Tansy's arc is `INTERNAL-ONLY`.

**Not canon, despite living in the repo.** `game/content/portrait-catalog.json`
contains `npc-only` portraits labelled **Baker** and **Milkman**. These are
art-library concepts with no world canon, no NPC ID, and no place in Holo
Hollow. Do not promote them into characters.

## Player encounter chronology and the Work Orders unlock

Work Orders require **two** separate things: the terminal, revealed by
completing **10,000 Hours**, and **Welding level 5**
(`balance.workOrders.requiredWeldingLevel`).

The guaranteed main-story chain is Walk It Off → Cut Your Teeth → Waste Not →
Hold It Together → Keep the Change → 10,000 Hours.

| NPC | Met by Work Orders unlock? | Basis |
| --- | --- | --- |
| Wade Rusk | **Guaranteed** | Offers the first Mission; introduces himself over comms on the alternate route; required again twice |
| Tansy Rusk | **Guaranteed** | Walk It Off's turn-in, by either offer route |
| Bix Weller | **Guaranteed** | Keep the Change carries a hard `npc_conversation` requirement on him |
| Mara Kells | **Guaranteed as an introduction only** | Speaks inside Bix's required scene. The player has met her; they may never have entered HH B&B or heard a single one of her topics |
| Renn Calder | **NOT guaranteed** | Out of the Weather is optional and the Assistance Center is never required |

**Encounter chronology does not decide who can be a Work Order client.**

> **Durable rule.** Work Order clients do not need to have been met, and do not
> need to be interactable NPCs. A named client may be an established NPC or a
> background resident introduced through authored job fiction. Player encounter
> chronology does not determine whether that person can use Rusk Recovery.

Holo Hollow exists independently of the order the player walks through it. A
resident's cart is broken whether or not the player has shaken their hand, and a
repair shop with a real local business would have customers the player has never
met. It is fine — arguably good — for a player to recognise a name from the board
and meet that person later.

What the table above is actually for is **dialogue and copy assumptions**. A job
naming somebody the player may not have met must not assume familiarity: no
"your friend", no "you remember", no callback to a conversation that may never
have happened. Renn is the live case — he is eligible as a client, and his job
copy must read as a work order rather than a favour between acquaintances.

Two further constraints on client choice, neither of which is about chronology:

- **Wade is excluded from the initial pool** — a framing decision, not a
  chronology one. He owns the yard, the bench and the terminal the paying work
  arrives through, so making him one of the first customers would blur *Wade
  assigning work around his own shop* with *customers bringing paying work in*.
  Direct apprentice or shop work from Wade stays available later.
- **Do not reason that Renn owns nothing.** Canon has not established his
  possessions either way, and absence of evidence is not a characterization. An
  ordinary working miner's own kit is a reasonable floor; a vehicle, a business,
  or a home is not.

### Background Work Order clients are not roster NPCs

A named background client introduced through job fiction is deliberately *not* an
entry in this bible. It gets no portrait, no dialogue, no map presence, no Wiki
page, and no biography — a name, an occupation, and the one possession the job
needs. That restraint is the point: it makes the town bigger without promising
five more characters.

The authored background clients and the minimal canon each one introduces live in
`docs/work-orders.md`. Do not expand them here, and do not promote one into this
roster without a deliberate decision to make them a real NPC.

### Welding level 5 — the paper arithmetic

Recorded because it will otherwise be re-derived, and re-derived wrongly.

Level 5 requires **2,320 total Welding XP** (`standardSkillLevelThresholds`:
500 to level 2, growing 10% per level). The guaranteed main story pays
**~1,000**: Hold It Together's Cargo Hold repair is 12 increments at 50 XP =
600, plus its 100 XP completion reward; 10,000 Hours' three Practice welds are
100 XP each = 300.

So the remaining gap is **~1,320 XP, or roughly 14 Practice welds**.

**A Practice weld always awards exactly 100 XP** — 10 sections at 10 XP — and
**Clean Pass does not change that.** A claimed Clean Pass awards one section's
XP and supplies that section without consuming time
(`server/clean-pass.ts`, `game/domain/practice-welding.ts`), so the weld still
completes at ten sections' worth of XP. **Clean Pass buys completion speed, not
XP.** Do not write it as a bonus.

Completing the optional **Out of the Weather** adds 750 XP (ten increments at 50,
plus its 250 XP reward), cutting the remaining gap to **~570 XP / about 6
Practice welds**.

At 2 Scrap per weld and an 8-slot starter container holding non-stacking Scrap,
that is **4 welds per full inventory** — roughly **3.5 inventories** without Out
of the Weather, or **1.5 with** it.

**This does not indicate a meaningful grind concern.** The level-5 requirement
stands as authored; Practice playtesting validates the feel, not this
calculation.

## Public-Wiki projection rules

A public character article is written **from the `Public-Wiki-safe facts` field
of that NPC's entry and from nothing else.** Apply **The publishing test**
above: the mandatory tutorial arc is documentable, and the question for
everything else is whether publishing it would materially damage an intended
discovery. See also `docs/public-wiki.md`.

**Publishable, and worth saying plainly.** The mandatory arc's world and
character facts: what these people do, where they are found, the businesses they
run, the skills they teach, the apprenticeship, and the ordinary relationships
the tutorial establishes. Wade's move to Rusk Recovery is already published in
the `holo-hollow` Wiki article and in a shipped Update — state it as where he is
found, not as a twist, but do state it.

**Never publish, for any NPC:**

- anything tagged `INTERNAL-ONLY` or `SPOILER-SENSITIVE`;
- **Tansy's `Beyond Holo Hollow` material** — that she wants to leave Holo
  Hollow, her sense of obligation to Wade or the town, or the projector /
  leaving-with-the-player arc. It is optional character material carrying her
  longer arc, and publishing it would spend a discovery the game means to make
  in play;
- **Tansy's parents, or the Friday movie tradition**, in any form;
- **the player character's amnesia or former delivery-running life.** It is
  reachable only inside optional gated dialogue, and is not public-safe merely
  because it ships. It must not appear on these pages even as background;
- approved-but-unshipped design as current fact — including Renn's age range,
  the Wade/Bix shared childhood, and anything about the Drive-In;
- implementation terminology: NPC IDs, Local Place IDs, Mission IDs, flags,
  requirement kinds, or registry names;
- a fact reached only by cross-link implication. A safe sentence that links to
  an unsafe page is not safe.

**Judge optional content case by case.** Optional Missions and topics are not
automatically publishable because they happen during the tutorial period, and
not automatically protected because they are optional. Ask what the discovery is
worth. Where a fact is already published in a shipped Update or an existing Wiki
article, it is public as a matter of record — but a character page may still
choose not to foreground it, which is an editorial decision rather than a
visibility classification. Mark that distinction explicitly when it applies.

Also: **`UNKNOWN` never becomes prose.** If a public article would read better
with a fact RuneSpace has not established, the article gets shorter, not
invented. A concise, truthful page is the standard.

## Open canon questions

Unresolved items, for a product decision rather than an agent's judgement.
Nothing below should be silently settled by content.

1. **Renn's standing at the Assistance Center** — receiving help, or helping?
   Deliberately unstated in shipped dialogue, and currently unresolvable from
   sources. Should stay open unless a story beat needs it. `UNRESOLVED`.
2. **Ages.** Only Renn has an approved range (late 20s–early 30s). Wade and Bix
   are "roughly the same age" with no number; Tansy and Mara have nothing.
   `UNKNOWN`.
3. **Where these people live.** Not established for any of the five. Mara living
   at the B&B and Wade living at the yard are both plausible and both currently
   unwritten. `UNKNOWN`.
4. **Parents and wider family.** Bix's parents and Mara's parents are referenced
   but unnamed, and whether either pair is living is unestablished. Tansy's
   parents are dead, unnamed, cause unstated. `UNKNOWN`.
5. **Do Renn and Tansy know each other?** `docs/holo-hollow.md` says Renn would
   tell younger residents *such as Tansy* not to give the town their whole
   lives, which implies acquaintance without establishing it. No shipped content
   places them together. `UNRESOLVED`.
6. **Tansy's promised anecdote** — Wade repairing a coolant manifold with a
   serving spoon. The tease is shipped; the story has never been written.
   `UNKNOWN`.
