# NPC conversations

Authoritative contract for RuneSpace's **one canonical NPC conversation model**
(issue #164). Every NPC — Wade Rusk, Tansy Rusk, and every future NPC — uses
this model. There is no legacy direct-Talk path, no per-NPC conversation
adapter, and no Bix/Renn-only topic path.

Read this together with `docs/missions.md`, which remains authoritative for
Mission state, prerequisites, requirements, offers, turn-ins, rewards,
continuation, and the server commands.

## 1. The player model

```text
NPC card → Talk to <NPC> → conversation hub → choose an entry → authored dialogue
```

The hub presents the conversations that are genuinely relevant right now, in
two sections:

| Section | What it contains |
| --- | --- |
| **Current** | Mission-derived conversations: an available offer, an active reminder/objective conversation, a turn-in, or the narrow latest completed-story follow-up. |
| **Talk about** | Replayable authored social/worldbuilding topics. |

Rules the presentation must keep:

- Mission-derived entries appear **above** ordinary topics.
- Mission entries keep the existing semantic guidance meaning: blue
  (`.rs-mission-available`, "there is a new mission here") and green
  (`.rs-mission-guidance`, "this advances the mission you accepted"). The hub
  never invents its own colour meaning — it reuses the derived guidance
  projection (§4).
- A topic label is a **short UI subject**, never a sentence the player character
  speaks. The player character is silent everywhere in RuneSpace.
- **Back** on the first beat and **Finish** on the last beat both return to the
  hub; the drawer's Close/Escape/backdrop dismisses the surface. Nothing in a
  conversation mutates character world position.
- The surface is mobile-first, keyboard-operable, and uses the shared
  `components/ui/Drawer` conventions.

Other NPC actions stay outside Talk. Bix exposes **Talk** and **Trade** as
separate actions (`docs/holo-hollow.md`).

## 2. Authoritative homes

| Concern | Home |
| --- | --- |
| Authored dialogue sequences (presentation content) | `game/content/dialogue.ts` — `DialogueSequence`, `DIALOGUE_SEQUENCES`, `getDialogue` |
| Authored replayable topics | `game/content/conversation-topics.ts` — `ConversationTopicDefinition`, `CONVERSATION_TOPICS`, `getNpcConversationTopics` |
| Mission conversation metadata | `game/content/missions.ts` — `MissionOffer` (`dialogueId`, `actionLabel`, `acceptedContinuation`, `activeDialogueId`), `MissionTurnIn` (`dialogueId`, `actionLabel`), `MissionDialogue`, `activeNpcDialogue`, `completedNpcDialogue`, and the `npc_conversation` requirement's own `dialogueId` / `actionLabel` |
| Skill-level-dependent dialogue (#391) | `game/content/dialogue.ts` — `SkillLevelDialogue`, `SKILL_LEVEL_DIALOGUES`, `DialogueSequence.skillLevelDialogueId`; `game/domain/skill-level-dialogue.ts` — the selector, `resolvePresentedDialogue`, validation; `server/play.ts` — `PlayGameplayState.skillLevelDialogue`. Recipe: §8 |
| Conversation resolution (pure) | `game/domain/conversation.ts` — `resolveNpcConversation`, `NpcConversationEntry`, `topicAvailable`, `validateConversationTopics`, `getMissionCompletionPresentation`, `getMissionCapacityRefusalDialogue` |
| Content validation at module load | `server/mission-state.ts` — `validateMissionDefinitions` + `validateConversationTopics` |
| Player-facing surfaces | `features/npc/NpcInteractionPanel.tsx` (the place's resident rows: Talk control + guidance, Trade), `features/npc/NpcConversation.tsx` (hub + command execution), `features/dialogue/DialoguePlayer.tsx` / `DialogueScene.tsx` (beat presentation) |
| Server authority | `server/missions.ts` — `acceptMission` / `completeMission` (unchanged by #164) |
| Who is present | `game/content/npcs.ts` — `getResidentNpcs({ locationId, localPlaceId, completedMissionIds })`, `resolveNpcPlacement`, `resolveNpcVenueBackgroundId` |

**Where the cards render (#190, #231).** Each resident's Local Contact card is
composed *inside* the panel for the place the player is in — directly under the
World Location's description, or under a Local Place's, above whatever gameplay
that place hosts (`LocalPlaceSurface`'s `residents` slot). It is one shared rule
for every venue, not a per-location arrangement: the people in front of the
player must never sit below the place's activity UI on a phone. When several
people stand in one place, each gets their own card in authored order, each
with their own Talk and Trade, and the place's own population line renders
once, after the people, rather than inside anybody's card. Every card keeps its
structural hairline above it, and one more hairline closes the resident block
before the population line so it never reads as part of the last card; with no
resident there is no leading divider. A resident with no available
conversation and no open merchant presents no card.

**Where a resident stands (#159, #231).** `getResidentNpcs` resolves every NPC
whose current placement matches one exact spatial context. An NPC with no
`localPlaceId` is present at their World Location, which is how Wade and Tansy
have always worked and still do. An NPC with a `localPlaceId` is found only
inside that Local Place, which is how Bix and Renn share Holo Hollow without
either appearing merely because the player is standing in town. Both halves
must match exactly, so a Local Place's residents never bleed into their parent
World Location and the reverse. The result is in the roster's authored order in
`game/content/npcs.ts` — never completion or arrival order — so the same state
presents the same people in the same sequence on every refresh, and each NPC
appears at most once. Rusk Recovery during Tansy's Fabrication chapter (#232) is
the first shipped context with two: Wade, then Tansy, each with their own card.

This is presentation, not authority. The client resolves residents from the
authoritative Mission projection to decide which cards to show, and every
Mission, conversation, and Trade command still revalidates its own location on
the server.

**When a resident moves (#190, #231).** An NPC authors a home placement
(`homeLocationId`, optional `localPlaceId`) and zero or more ordered
Mission-derived relocations:
`relocations: [{ afterCompletedMissionId, locationId, localPlaceId?, conversationBackgroundId? }]`.
`resolveNpcPlacement` takes the character's own completed Missions and returns
the **latest entry in authored order** whose Mission is complete, or the home
placement when none is. A later entry wins over an earlier one whichever Mission
happened to finish first, and a completed Mission that no entry names changes
nothing. Wade authors one entry: he is at the Crash Site until Keep the Change
completes and at Rusk Recovery afterwards. Tansy authors two (#232): her home is
The Jag; completing 10,000 Hours brings her to Rusk Recovery for her Fabrication
chapter, and completing Break It Down takes her home again. That is one person in several places
over time — never a second "shop Wade", and never a persisted relocation flag
that could disagree with the Mission record. Where a conversation happened stays
authored per beat, so his Crash Site beats keep the Crash Site behind them and
his yard beats use the yard: a person moving is new beats in a new place, not a
dynamic-background system that retroactively relocates what they already said.

**Scenes stay put; present-tense conversation follows the speaker (#190).**
Two different things share the word "background". A scene or a comms call
happened somewhere specific, and its authored `backgroundId` is the truth
forever. A replayable topic or a post-Mission follow-up is not a scene at all —
it is the person standing in front of the player today, and after a relocation
it would otherwise be presented in a place neither of them is in. Such a
sequence opts in with `presentsAtCurrentVenue: true`, and its **local** beats
are presented against `resolveNpcVenueBackgroundId(npc, completedMissionIds)`:
the current relocation's `conversationBackgroundId` once a move has happened,
and the NPC's ordinary `conversationBackgroundId` before it (or when the current
relocation authors no venue of its own). Comms beats are never overridden,
authored content is never rewritten, no topic is duplicated per venue, and
nothing new is persisted — the venue comes from the same completed-Mission set
that decides where the person is standing. An NPC who never moves resolves the
background they were already authored against, so this changes nothing for
anybody else.

**A room the player changed is shown changed (#292).** A conversation
background may name a `repaired` variant: the matching art the same backdrop
becomes once a named repair target is complete. Curly's unfinished guest room
names the finished one, his mount being the repair. `DialoguePlayer` resolves
it per beat from the character's completed repairs, after any
`presentsAtCurrentVenue` override, so the two never undo each other; nothing is
persisted, and a beat authored against the finished room is simply that room.
Curly's sequences never use the venue override.

**A conversation outlives its speaker's move (#232).** Completing a Mission can
move the very person the player is talking to — Tansy walks home the moment
Break It Down completes. Her card leaves the place at once, but the open
conversation stays mounted, as the same instance, until the player closes it, so
the completion scene plays to the end (`NpcInteractionPanel` keeps a departing
person's contact with no card while their conversation is open). Presentation
only; nothing is persisted.

This is story placement, not an NPC schedule or movement engine. Nothing reads
the clock; there are no shifts, pathing, random presence, or presence flags, and
nothing about placement is persisted. A story beat that moves somebody earns its
own authored relocation entry, added with the Mission that causes it.

**Authored capacity refusals (#170, #190).** A Mission command that refuses
because a grant will not fit reports `reason: "capacity"` with its
`capacityReason`, and the conversation surface swaps to that Mission's authored
refusal beat (`getMissionCapacityRefusalDialogue`) instead of showing a generic
message. Since #190 this covers both ends of a Mission: the turn-in's item
reward (Walk It Off) and an offer's `stack_item` acceptance effect (10,000
Hours). The surface branches on the refusal shape, not on which command it was,
so both paths present through one code path. A Mission may point both authored
slots at one shared sequence when the person refusing has nothing different to
say about slots than about mass.

## 3. Ownership rule: sequences are presentation, Missions own action semantics

A `DialogueSequence` is **only** `{ id, npcId, beats }`. It carries no
`action` and no `actionLabel`.

Mission command semantics — *which* Mission, *which* command, and the authored
control copy — are carried by the resolved conversation entry, derived from
Mission content:

```ts
type MissionConversationAction = {
  kind: "accept_mission" | "complete_mission" | "acknowledge_conversation";
  label: string; // MissionOffer.actionLabel / MissionTurnIn.actionLabel / the
                 // requirement's actionLabel, else a generic default
  dialogueId?: DialogueId; // acknowledge_conversation only — which scene was played
};
```

Consequences that must stay true:

- Dialogue prose never determines gameplay truth, and a social topic can never
  accidentally carry a Mission command. Registry validation rejects a topic that
  reuses any Mission-owned sequence.
- A reminder or busy branch presents state only. The completion action attaches
  **only** when stage routing selects the mission's own `turnIn.dialogueId`, or
  one of its reactive turn-in openings (`docs/missions.md` §9.3), which rejoin
  the same completion.
- Selecting an entry in the client grants no Mission authority: `server/missions.ts`
  re-reads and revalidates prerequisite, offer route, turn-in NPC, location,
  stationary state, and every requirement inside the character transaction.

Current authored labels include `Claim Cutter` (Walk It Off), `SHOW SHALE` (Cut
Your Teeth), `REPORT TO WADE` (Waste Not), `REPORT REPAIR` (Hold It Together, Wheel Be Right Back, Thrust Issues), `FIX THE DRIVE` (Thrust Issues offer),
`HAND OVER THE CUTTER` (Return the Favor, Cutting Costs), `SHOW HER THE CUTTER`
(A Cut Above), `TELL TANSY` (Break It Down, Brace Yourself), and `COLLECT PAYMENT`
(Curly Must-Stash).
Offers fall back to `Accept mission`; a turn-in without authored copy falls back
to `Turn in`.

## 4. Resolution order

`resolveNpcConversation(npcId, projections)` consumes the semantic Mission
projections (`state.missions`) — never objective prose, dialogue text, or
hard-coded mission-ID chains — and returns an ordered entry list:

1. **Accepted Mission conversations**, newest Mission first. For the turn-in NPC
   the stage branch is selected exactly as before (turn-in / busy / equipment /
   carried / tracked-activity / cargo-repair / conversation reminder), with a
   reactive variant replacing the turn-in opening or the tracked-activity
   reminder when a Mission-local fact holds (#232, `docs/missions.md` §9.3). A
   reminder or busy moment the Mission leaves unauthored presents the turn-in
   opening only when the Mission declares it in `dialogue.omitted`; otherwise
   there is no entry (`docs/missions.md` §9.4). For other
   NPCs an **unsatisfied mandatory conversation** (§4.1) wins first, then the
   authored `activeNpcDialogue`, then that NPC's offer `activeDialogueId`.
2. **Available offers**, newest first: a `not_accepted` Mission whose projected
   prerequisite is satisfied and which authors an offer at this NPC.
3. **The latest relevant completed-story follow-up** — at most one entry, and
   only when this NPC has no current Mission conversation. Completed Missions
   must not accumulate into a growing historical list. The one-shot completion
   presentation is never reused as idle dialogue.
4. **Replayable topics** whose authored availability currently holds, in
   authored order.

Several genuinely relevant Mission conversations can coexist for one NPC; the
layer deliberately does **not** collapse them into a single global winner.

Entry guidance (`"available"` / `"active"`) is read from the projection's own
`guidance` (`MissionGuidance.npcId` / `availableNpcIds`, `docs/missions.md` §10),
so the hub cannot drift from the Talk control's treatment. Active green wins
when a projection somehow reports both.

### 4.1 One-time mandatory conversations

A Mission may require the player to genuinely meet somebody (`npc_conversation`,
`docs/missions.md` §5). That scene is a **one-time story event**, not idle
dialogue:

- it appears in that NPC's hub only while the requirement is unsatisfied, and
  carries `acknowledge_conversation`, whose server command is the only thing
  that can satisfy it;
- leaving early records nothing, so it can be entered again — the event has not
  authoritatively happened yet;
- once the command succeeds the entry disappears from the hub permanently. It is
  **not** moved into `Talk about`, and nothing else replays it. Keep the Change's
  Bix scene — where Mara meets the player — is the production example.

Satisfaction is read from the projection's own requirement statuses, so this
needs no conversation history (§6). The authored sequence keeps its stable
content ID for identity even once ordinary play can no longer reach it.

### 4.2 Optional lead conversations (#369)

A conversation requirement may author optional **leads** (`docs/missions.md`
§5.2): scenes at other NPCs that point the player to the required contact. A
lead scene is the same kind of one-time story event as §4.1, and its rules are
the same except for when it stops being offered:

- it appears in the lead NPC's hub only while the requirement is unsatisfied
  **and** no lead has yet been followed, then disappears for good;
- it carries `acknowledge_conversation`, the only thing that records the lead;
  leaving a scene early records nothing;
- it plays where that NPC stands for this character: its sequence is authored
  `presentsAtCurrentVenue`, so Wade and Tansy speak against their current venue
  after a Mission-derived relocation, with no background of their own to drift;
- the NPC's ordinary topics and other Missions are unaffected.

Not From Around Here is the production example: Wade or Tansy points to Toll, and
visiting Toll directly needs neither.

### 4.3 An item offer made in person (#389)

An offer route may author `requiresCarriedOfferItem` (`docs/missions.md` §4.1):
it is listed only while the projection carries an `itemOffer` — the character
genuinely carries a stack of one of the Mission's offering items — and the
acceptance command rechecks that carried stack. Two presentation fields go with
it, both optional and usable by any offer:

- `subject` — the hub entry's short UI subject instead of the Mission title
  ("Show strange mineral"). It is an interface label, never a player line.
- `declineLabel` — an explicit decline control ("Not now") beside the acceptance
  control on the offer's last beat. It is `onFinish`: back to the hub, no
  command, nothing written. Back and the drawer's Close behave as ever.

After a successful acceptance with no authored continuation the surface returns
to the same hub, which re-derives from the new state and now lists the Mission's
turn-in at that NPC, so the player never leaves the conversation.

### 4.4 Grouped topics and Research Jobs (#406)

The Wise Old Enby is the one NPC whose hub is grouped. Story Mission
conversations (the **Current** section) stay on the top level, including offers,
reminders and turn-ins, and the previously flat **Talk about** list becomes two
buttons beneath them: **Conversation Topics** (their replayable topics, with Back)
and **Research Jobs** (`features/research/ResearchJobsView.tsx`). Selecting either
enters a focused list of its own; Back returns to the hub, and a topic's Back or
Finish returns to the Conversation Topics list. Every other NPC keeps the single
"Talk about" list.

Research Jobs lists the open jobs with their pitch, needs and reward. A job locked
behind the story (Resonance Calibration) is not listed. While one job is held, the
others stay visible but blocked, naming it. A job's dialogue is selected from
authoritative state, never from a Mission: the full briefing until the character has
completed that job once, then the short introduction (the full briefing stays
replayable), the reminder for the run's progress, and the return conversation that
carries the final action. **Accept** (`ACCEPT ASSIGNMENT` / `NOT RIGHT NOW`),
**COLLECT PAYMENT** and **OPEN PASSAGE TO SKATBOLL** are research commands
(`docs/missions.md` §15), not Mission commands, and no dialogue transaction exists:
backing out of a scene never commits anything. **OPEN PASSAGE TO SKATBOLL** only opens
a separate confirmation modal; the whole farewell plays first, on Stillreach.

## 5. Replayable topics

```ts
type ConversationTopicDefinition = {
  id: ConversationTopicId;   // stable content ID in game/config/foundations.ts
  npcId: NpcId;
  label: string;             // short UI subject, never a player line
  dialogueId: DialogueId;    // an NPC-owned sequence used by no Mission
  availability: ConversationTopicAvailability;
};

type ConversationTopicAvailability =
  | { kind: "always" }
  | { kind: "mission_accepted"; missionId: MissionId }
  | { kind: "mission_completed"; missionId: MissionId };
```

The availability vocabulary is **closed and narrow**. `mission_completed` reads
the existing semantic Mission projection and requires no new persistence.
`mission_accepted` (#391) reads the same projection and holds from acceptance
onward — Active, ready, or Completed — so a lesson's instructions stay
replayable for the rest of the game once they have been given. Do not
add a generic boolean-expression DSL, relationship/reputation meter, hidden trust
score, or world-state scripting language. If real later content needs another
kind, extend this closed union deliberately when that use case arrives.

Registry validation (`validateConversationTopics`, run at module load) rejects
unknown NPCs or dialogue, an NPC/dialogue mismatch, empty or duplicate subjects
for one NPC, a duplicate topic ID, an unknown Mission gate, and any topic that
reuses a Mission-owned sequence.

### Currently authored topics

| NPC | Subject | Availability |
| --- | --- | --- |
| Wade Rusk | Recovery work | always |
| Wade Rusk | Stash mounts | after **Hold It Together** is completed |
| Wade Rusk | Skatboll | always |
| Tansy Rusk | Mining | always |
| Tansy Rusk | Beyond Holo Hollow | after **Hold It Together** is completed |

Tansy's topics present at her current venue (`presentsAtCurrentVenue`, #232):
at Wade's yard during her Fabrication chapter, at The Jag otherwise.
| Bix Weller | The shop | always |
| Bix Weller | Power Cells | always |
| Bix Weller | Holo Hollow | always |
| Bix Weller | Skatboll | always |
| Mara Kells | The B&B | always |
| Mara Kells | Bix | always |
| Renn Calder | The Assistance Center | always |
| Renn Calder | Ferrite | always |
| Renn Calder | Life here | always |
| Renn Calder | Skatboll | always |
| Curly | Seeing the Worlds | always |
| Curly | Back Home | after **Curly Must-Stash** is completed |
| Toll Kade | Skatboll | always |
| Toll Kade | Stillreach | always |
| Toll Kade | Fuel | always |
| Werner | About the Lab | always |
| Werner | The Quarry | always |
| Werner | Gem Cutting | always |
| The Wise Old Enby | Introductions | always |
| The Wise Old Enby | The workshop | always |
| The Wise Old Enby | Stillreach | always |
| The Wise Old Enby | About RuneSpace | after **Not From Around Here** is completed |
| The Wise Old Enby | First lesson | once **First Runeworking Lesson** is accepted |
| The Wise Old Enby | Where to Find Fragments | after **Not From Around Here** is completed |
| The Wise Old Enby | About the Seekers | after **First Runeworking Lesson** is completed |
| The Wise Old Enby | How to Listen | once **First Resonance Echo** is accepted |
| The Wise Old Enby | About Resonance Echoes | after **First Resonance Echo** is completed |

The Wise Old Enby (#389) stands at Hilltop Workshop itself (no Local Place), so
their first three topics are there for anyone who reaches the hill, with or
without a Rune Fragment or the Mission, and say nothing about how runes work.
"Introductions" is their greeting: a replayable topic like any other, with no
first-meeting state. They are "the Wise Old Enby" and they/them wherever they
are referred to; the player stays silent. Every sequence is authored against
their own approved 15:8 workshop interior with the four portraits (neutral,
friendly, thoughtful, amused) separate from it. *About RuneSpace* is an ordinary
`mission_completed` topic: replaying it runs no command, pays nothing and records
nothing.

*First lesson* replays the lesson's instruction scene (#391) as a topic of its
own: the same verbatim beats, authored in a topic-owned sequence because a topic
may never reuse a Mission-owned one. *Where to Find Fragments* is nothing but
the Enby's skill-level-dependent Fragment advice (§8), and *First lesson* ends
with it too, so both always give the advice the character's current Mining level
earns. *About the Seekers* is the lesson's aftercare. *How to Listen* (#393)
replays First Resonance Echo's instructions — never its gift — and *About
Resonance Echoes* is that Mission's aftercare. *Stillreach* carries the Enby's
three owner-approved personal beats (#393) before its unchanged closing line;
it stays `always`, before and after any Mission, and changes nothing. None of them carries a
Mission command; the Resonance Rig is a separate control below the Enby's card
and is never reached through Talk.

Bix's **Trade** action is deliberately separate from **Talk** (see
`docs/holo-hollow.md`): the conversation hub never carries a merchant command,
so Keep the Change requires the conversation with Bix while never requiring a
purchase — opening Trade satisfies nothing.
Renn has no merchant function. He is no longer social-only: #172 gave him
**Out of the Weather**, which he both offers and turns in (`docs/missions.md`).
His three topics remain ordinary replayable conversation and still carry no
Mission command — the Mission is resolved by Mission content, not by the topic
hub, exactly as for every other NPC.

The Skatboll topics (#402) give the same planet/town fact three different
speakers' angles instead of repeating Toll's shipping-label line: Bix's
tourists thought one street was the whole planet, Renn's quiet correction is
that a town is not a planet no matter how hard it talks about itself, and
Wade's is that recovery work needs the wreck's actual location, not a town/planet mix-up.
Each is `always`, carries no Mission or Trade action, and adds no new place,
mechanic, or canon fact — in particular Renn's says nothing about his own
standing at the Assistance Center, which Canon leaves deliberately unresolved.

Toll Kade (#357) works inside the Last Leg Trading Local Place at Holo Hollow
Landing, so his three topics are listed for anyone standing in that shop, on
foot, before Trade unlocks and before any Mission; none records that it was read
and none carries a Mission or Trade action. Their text and expression
assignments (neutral, friendly, thoughtful, skeptical) are owner-approved and
authored verbatim in `game/content/dialogue.ts` against the shop's own 15:8
interior background, with his four portraits kept separate from it. His **Trade**
action is a separate control that reads the merchant's completed-Thrust-Issues
unlock (`docs/gameplay-foundations.md`) and, while locked, says so instead of
opening a counter.

Werner (#429) stands at the World Location Werner's Lab itself, with no Local Place, so
his three topics are listed for anyone who walks there, before any Mission, level or
conversation. Each has three beats whose text and expression (neutral, thoughtful, amused,
intense) are owner-approved and authored verbatim in `game/content/dialogue.ts` against the
lab's own people-free 15:8 interior, with his four portraits kept separate from it. They are
evergreen, written to read the same for a newcomer and for a Lapidary expert, and carry no
Mission, item, XP, price or Trade action. His signature line stays out of them: it is
reserved for his later introductory Mission. **Talk** and **Trade** are separate controls.

Curly's **Seeing the Worlds** needs no gate for the same reason (#292): he shares
Mara's place, so it is there whether or not his Mission is on offer yet.
It is authored against his unfinished room, which resolves to the finished one
once his mount is installed (below), so replaying it never shows a room the
player has already changed.

Mara's topics carry no availability gate of their own because she is only
reachable inside HH B&B, and that Local Place's access already derives from Keep
the Change's completion (`docs/gameplay-foundations.md`, Local Places). One gate,
not two: a second condition could otherwise leave her present with nothing to
say. Her appearance in Bix's shop during that Mission is authored Mission
dialogue, never a topic, and never makes her a second resident of the shop.

**Beyond Holo Hollow** seeds Tansy's long-term arc without resolving it: she
wants to see other stations and planets, has spent her life around Holo Hollow
and The Jag, feels responsible for Wade and for the community, knows Wade never
asked her to stay, knows the obligation is self-imposed, knows she could leave,
and struggles to want something for herself. The player once lived the
travelling life she wants but was robbed of the memories. Hold It Together
cannot complete without the three starter Missions before it, so its completion
alone is the gate.

## 6. No conversation-history persistence

RuneSpace persists **nothing** about conversations. There is no
`seenTopicIds`, no NEW badge, no viewed-topic checkmark, no conversation-history
table, and no first-meeting or has-met flag. Topics are replayable, and the hub
is derived fresh from authoritative state on every render.
`tests/unit/npc-conversation.test.ts` guards this across the schema, server,
domain, content, and UI files.

If future gameplay requires the player having learned a specific fact to matter
mechanically, that concrete knowledge requirement earns persistence then — as a
deliberate, narrow extension, not as conversation history.

**Issue #170 is exactly that case, and stayed inside this boundary.** Keep the
Change needs one fact to matter mechanically: the player has actually met Bix.
That is persisted as the Mission's own requirement progress (one capped row for
one authored key, `docs/missions.md` §12.3) — not as a conversation record.
There is still no `seenTopicIds`, no NEW badge, no viewed-topic checkmark, no
conversation-history table, and no has-met flag for anybody else; optional
topics remain replayable and unrecorded.

## 7. Authoring checklist

Adding a replayable topic:

1. Add a stable `CONVERSATION_TOPIC_IDS` entry and a `DIALOGUE_IDS` entry in
   `game/config/foundations.ts`.
2. Author the sequence in `game/content/dialogue.ts` using the existing typed
   helpers. Every beat must be spoken by the topic's NPC; the player stays
   silent.
3. Add the `ConversationTopicDefinition` in
   `game/content/conversation-topics.ts` with a short subject label and an
   availability from the closed union.
4. Cover it in `tests/unit/npc-conversation.test.ts`.

Adding an ordinary Mission conversation needs **no** conversation-layer change:
author the Mission's offers, turn-in, dialogue mapping, `activeNpcDialogue`, and
`completedNpcDialogue` and the hub picks it up (`docs/missions.md` §13).

If a new conversation seems to need a mission-ID branch in React, a bespoke
accept/complete path, prose parsing, or a per-NPC conversation adapter, stop and
inspect whether this model is being bypassed.

Adding skill-level-dependent lines: follow §8.

### Dialogue scene location labels (issue #357 follow-up)

The dialogue background identifies the place shown, not merely the World Location
of the character. For an interior, author its `localPlaceId` alongside its parent
`locationId` in `game/content/conversation-backgrounds.ts`. Both the actual
`DialogueScene` plate and the QC Studio background selector derive the label
from that Local Place registry entry. Outdoor/exterior backdrops continue to
show the World Location. The scene plate is single-line and ellipsizes when the
full name is too long; the full location name remains accessible in its text
and title attribute.

## 8. Skill-level-dependent dialogue (#391)

Some advice should depend on what the character can already do: the Wise Old
Enby sends a novice miner to the Prospecting Quarry for Rune Fragments and an
experienced one to Harmonic Workings. That is a **skill-level-dependent
dialogue**: one authored choice between ordinary sequences of the same NPC, by
the character's level in one skill. It is content plus a tiny pure selector —
not a scripting language, not a condition in React, and no new persistence.

### Where it lives

| Piece | Home |
| --- | --- |
| The choice (skill, thresholds, variant sequences) | `SKILL_LEVEL_DIALOGUES` in `game/content/dialogue.ts`, typed by `SkillLevelDialogue` |
| Its stable ID | `SKILL_LEVEL_DIALOGUE_IDS` in `game/config/foundations.ts` |
| Invoking it from a sequence | `skillLevelDialogueId` on any `DialogueSequence` |
| Selection and the played beats (pure) | `game/domain/skill-level-dialogue.ts` — `selectSkillLevelDialogueVariant`, `selectSkillLevelDialogues`, `resolvePresentedDialogue` |
| Authority | `server/play.ts` puts `skillLevelDialogue` (choice ID → selected variant ID) on every `PlayGameplayState`, from the character's persisted XP |
| Presentation | `features/npc/NpcConversation.tsx` plays `resolvePresentedDialogue(dialogueId, state.skillLevelDialogue)` |
| Fail-fast validation | `validateSkillLevelDialogues`, run at module load by `server/mission-state.ts` |

The production example is `SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice`,
invoked by the lesson's instruction scene (`wiseOldEnbyFirstLesson`), its replay
topic (`wiseOldEnbyFirstLessonTopic`), and the *Where to Find Fragments* topic
(`wiseOldEnbyWhereToFindFragmentsTopic`). Tests:
`tests/unit/first-runeworking-lesson.test.ts` (selector, fallback, refresh,
validation) and `tests/integration/first-runeworking-lesson.test.ts` (the
server's selection at Mining 7, 8 and with no Mining XP row).

### The recipe

1. Author each variant as an ordinary sequence of the NPC in `dialogue.ts`,
   with its own `DIALOGUE_IDS` entry. Variants carry only beats — never a
   Mission command — and every beat is the NPC's (the player stays silent).
2. Declare the choice, lowest threshold first:

   ```ts
   // game/config/foundations.ts
   export const SKILL_LEVEL_DIALOGUE_IDS = {
     wiseOldEnbyFragmentAdvice: "wise_old_enby_fragment_advice",
   } as const;

   // game/content/dialogue.ts — SKILL_LEVEL_DIALOGUES
   {
     id: SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice,
     npcId: NPC_IDS.wiseOldEnby,
     skillId: SKILL_IDS.mining,
     variants: [
       { minimumLevel: 1, dialogueId: DIALOGUE_IDS.wiseOldEnbyFragmentAdviceNovice },
       {
         // Read from the gate the advice is about, never restated.
         minimumLevel: getEffectiveGameBalance().mining.sources.harmonicMining.requiredMiningLevel,
         dialogueId: DIALOGUE_IDS.wiseOldEnbyFragmentAdviceExperienced,
       },
     ],
   },
   ```

3. Invoke it from every sequence that should end with it:

   ```ts
   [DIALOGUE_IDS.wiseOldEnbyFirstLesson]: {
     id: DIALOGUE_IDS.wiseOldEnbyFirstLesson,
     npcId: NPC_IDS.wiseOldEnby,
     skillLevelDialogueId: SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice,
     beats: [/* the scene's own beats, played first */],
   },
   // A topic whose whole subject is the advice authors no beats of its own.
   [DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic]: {
     id: DIALOGUE_IDS.wiseOldEnbyWhereToFindFragmentsTopic,
     npcId: NPC_IDS.wiseOldEnby,
     skillLevelDialogueId: SKILL_LEVEL_DIALOGUE_IDS.wiseOldEnbyFragmentAdvice,
     beats: [],
   },
   ```

4. Use the invoking sequence wherever a sequence ID goes — a Mission offer,
   continuation, completion presentation or a topic. Nothing else changes: the
   conversation surface resolves every played sequence through
   `resolvePresentedDialogue`.
5. Cover the thresholds in a unit test (`selectSkillLevelDialogueVariant` at the
   level below and at each threshold, plus a missing skill) and the played beats
   (`resolvePresentedDialogue`).

### Rules

- **Thresholds.** `variants` ascend strictly; the first is always
  `minimumLevel: 1`. A variant applies from its `minimumLevel` up to the next
  one's, so only one variant's lines are ever played — never both branches.
  When the advice is about a gate (a source's required level, a recipe's
  minimum), read the threshold from that registry so it cannot drift.
- **Fallback and missing skill.** No XP row in the skill is Level 1 (the
  starting level), so it selects the first variant. A Play state that does not
  name the choice — an older client state, a test fixture — also plays the
  first variant. A choice is never silent.
- **Authority.** The server computes the selection from persisted XP through the
  skill's own curve (`skillLevelThresholds`), in the same Play state as
  everything else. The client never reads XP or knows a threshold; it plays the
  variant the map names. Choosing lines grants, records and unlocks nothing.
- **Order.** The invoking sequence's own beats play first, then the selected
  variant's. A choice is a tail; there is exactly one per sequence.
- **Refresh.** Selection is recomputed on every Play state, so a character who
  levels up and returns hears the new variant the next time the conversation is
  opened. A conversation already open keeps the beats it started with.
- **Reuse.** Several sequences may invoke one choice; the lines are authored
  once. Validation rejects a duplicate choice ID, a skill without a level
  curve, fewer than two variants, a first threshold other than 1, thresholds
  that do not ascend or exceed the skill's maximum, an unknown, wrong-NPC or
  beat-less variant or one that itself invokes a choice, a beat-less sequence
  that invokes nothing, and a sequence invoking an unknown choice or another
  NPC's.
- **QC Studio.** Variants are ordinary sequences and preview as such. A
  beat-less invoking sequence (a topic that is only the choice) has nothing of
  its own to preview and is left out of the QC Studio dialogue list
  (`docs/qc-studio.md`).

Do not grow this into conditions on Missions, items or flags. A line that
depends on a Mission's state is Mission dialogue (`docs/missions.md` §9); a
topic that depends on a Mission is topic availability (§5).

## Linear Mission stages (#431)

Accepted staged Missions resolve the active stage before choosing dialogue.
An unsatisfied current-stage mandatory conversation wins even when its NPC also
offers the Mission and owns the final turn-in. Future-stage conversations are
not entries. Stage-specific reminders use the existing semantic requirement
routing; only the final stage can carry the ordinary completion command.
A teaching gift reveals its item beat only after an acknowledged stage-transition
receipt; capacity refusal leaves the conversation requirement and stage open.
Werner's three replayable Slice A topics remain unchanged. His reserved payoff
is confined to the new Mission's successful completion presentation.
