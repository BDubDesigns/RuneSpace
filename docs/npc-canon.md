# NPC Canon — pointer to the Notion Canon

RuneSpace's world and narrative canon lives in **Notion**, not in this
repository. This file explains where it is, what it owns, and how to use it. It
deliberately contains no canon of its own.

**Canon:** <https://app.notion.com/p/3e72a9ef9db281ff9c54d4fa181fddc3>
(RuneSpace → Canon)

## Source of truth

- **Notion Canon** is authoritative for world and narrative canon: NPC identity
  and characterization, relationships, established backstory, locations and
  world facts, companies and organizations, reveal sequencing and spoiler-state
  facts, and approved-but-not-yet-shipped narrative facts.
- **Shipped code and content** are authoritative for shipped behavior: stable
  IDs, actual current NPC placement, Mission requirements and rewards, merchant
  values, level curves, live dialogue IDs and routing, database state, and
  gameplay rules. See the owners listed below.
- **GitHub Issues** are authoritative for implementation contracts once a
  planned change becomes engineering work. An Issue links to the relevant Canon
  or design page rather than copying it.

When shipped behavior and Canon disagree, that is a **discrepancy to
reconcile**: record it on the affected Canon page and raise it with Brandon. Do
not silently redefine Canon around an implementation accident, and do not
silently change shipped behavior to match Canon.

## What is in the Canon

- **Canon conventions & publishing rules** — the two-tag classification (canon
  status: `SHIPPED`, `APPROVED — NOT SHIPPED`, `UNKNOWN`, `UNRESOLVED`;
  visibility: `PUBLIC-SAFE`, `SPOILER-SENSITIVE`, `INTERNAL-ONLY`), the
  publishing test, locked canon versus player reveal state, the Visual identity
  rule, and the Public-Wiki projection rules.
- **NPCs** — one page per named recurring character (Wade Rusk, Tansy Rusk, Bix
  Weller, Renn Calder, Mara Kells), plus cast-wide rules: encounter chronology,
  Work Order client eligibility, background clients, and the cast-wide open
  questions.
- **Locations**, **Organizations & Companies**, and **World & History**.

Narrative *design* — arcs, dialogue planning, reveal planning, and future
story — stays in the Notion **Characters & Narrative**, **World**, and
**Gameplay Systems** areas. Canon records what is true.

## Rules for agents and contributors

- **Read the relevant Canon page before writing** any dialogue, Mission, Work
  Order, Update, or Wiki copy involving a named NPC.
- **The Canon is internal and spoiler-complete.** Never copy from it into
  player-facing text. A public Wiki character page is written only from the
  `Public-Wiki-safe facts` on that character's Canon page (`docs/public-wiki.md`).
- **This repository is public.** Never quote protected canon — anything tagged
  `SPOILER-SENSITIVE` or `INTERNAL-ONLY`, or any approved-but-unshipped story —
  into repository docs, code comments, commit messages, or PR descriptions.
  Refer to it by Canon page name instead.
- **`UNKNOWN` is a valid, final answer.** If content needs a fact the Canon has
  not established, that is a product decision for Brandon, not something to
  fill in.
- **No Notion access?** Stop and ask. Do not reconstruct canon from shipped
  dialogue, chat history, session memory, or an older copy of this file.

## Where shipped behavior lives

Canon pages cite these rather than copying values that could drift:

- stable IDs, roster, placement, relocation, expression art —
  `game/config/foundations.ts`, `game/content/npcs.ts`
- authored dialogue — `game/content/dialogue.ts`
- replayable topics and the conversation model —
  `game/content/conversation-topics.ts`, `docs/npc-conversations.md`
- Missions and the Mission framework — `game/content/missions.ts`,
  `docs/missions.md`
- residence, Local Places, merchants — `game/content/local-places.ts`,
  `game/content/merchants.ts`, `game/content/locations.ts`
- Work Orders and their clients — `game/content/work-orders.ts`,
  `docs/work-orders.md`
- settlement, economy, and approved town direction — `docs/holo-hollow.md`
- balance and level curves — `game/config/balance.ts`

## History

Until #220 this file was the full internal character bible. Its content was
migrated into the Notion Canon and verified for parity before this file was
reduced. The last full version remains in git history
(`git show d1f2831:docs/npc-canon.md`) for rollback only; it is **not** current
canon and must not be used as a source.
