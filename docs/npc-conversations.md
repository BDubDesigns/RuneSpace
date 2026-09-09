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

Other NPC actions stay outside Talk. Bix will later expose **Talk** and
**Trade** as separate actions (`docs/holo-hollow.md`).

## 2. Authoritative homes

| Concern | Home |
| --- | --- |
| Authored dialogue sequences (presentation content) | `game/content/dialogue.ts` — `DialogueSequence`, `DIALOGUE_SEQUENCES`, `getDialogue` |
| Authored replayable topics | `game/content/conversation-topics.ts` — `ConversationTopicDefinition`, `CONVERSATION_TOPICS`, `getNpcConversationTopics` |
| Mission conversation metadata | `game/content/missions.ts` — `MissionOffer` (`dialogueId`, `actionLabel`, `acceptedContinuation`, `activeDialogueId`), `MissionTurnIn` (`dialogueId`, `actionLabel`), `MissionDialogue`, `activeNpcDialogue`, `completedNpcDialogue` |
| Conversation resolution (pure) | `game/domain/conversation.ts` — `resolveNpcConversation`, `NpcConversationEntry`, `topicAvailable`, `validateConversationTopics`, `getMissionCompletionPresentation`, `getMissionCapacityRefusalDialogue` |
| Content validation at module load | `server/mission-state.ts` — `validateMissionDefinitions` + `validateConversationTopics` |
| Player-facing surfaces | `features/npc/NpcInteractionPanel.tsx` (Talk control + guidance), `features/npc/NpcConversation.tsx` (hub + command execution), `features/dialogue/DialoguePlayer.tsx` / `DialogueScene.tsx` (beat presentation) |
| Server authority | `server/missions.ts` — `acceptMission` / `completeMission` (unchanged by #164) |

## 3. Ownership rule: sequences are presentation, Missions own action semantics

A `DialogueSequence` is **only** `{ id, npcId, beats }`. It carries no
`action` and no `actionLabel`.

Mission command semantics — *which* Mission, *which* command, and the authored
control copy — are carried by the resolved conversation entry, derived from
Mission content:

```ts
type MissionConversationAction = {
  kind: "accept_mission" | "complete_mission";
  label: string; // MissionOffer.actionLabel / MissionTurnIn.actionLabel, else a generic default
};
```

Consequences that must stay true:

- Dialogue prose never determines gameplay truth, and a social topic can never
  accidentally carry a Mission command. Registry validation rejects a topic that
  reuses any Mission-owned sequence.
- A reminder or busy branch presents state only. The completion action attaches
  **only** when stage routing selects the mission's own `turnIn.dialogueId`.
- Selecting an entry in the client grants no Mission authority: `server/missions.ts`
  re-reads and revalidates prerequisite, offer route, turn-in NPC, location,
  stationary state, and every requirement inside the character transaction.

Current authored labels: `Claim Cutter` (Walk It Off), `SHOW SHALE` (Cut Your
Teeth), `REPORT TO WADE` (Waste Not), `REPORT REPAIR` (Hold It Together).
Offers fall back to `Accept mission`; a turn-in without authored copy falls back
to `Turn in`.

## 4. Resolution order

`resolveNpcConversation(npcId, projections)` consumes the semantic Mission
projections (`state.missions`) — never objective prose, dialogue text, or
hard-coded mission-ID chains — and returns an ordered entry list:

1. **Accepted Mission conversations**, newest Mission first. For the turn-in NPC
   the stage branch is selected exactly as before (turn-in / busy / equipment /
   carried / tracked-activity / cargo-repair reminder); for other NPCs the
   authored `activeNpcDialogue`, else that NPC's offer `activeDialogueId`.
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
  | { kind: "mission_completed"; missionId: MissionId };
```

The availability vocabulary is **closed and narrow**. `mission_completed` reads
the existing semantic Mission projection and requires no new persistence. Do not
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
| Tansy Rusk | Mining | always |
| Tansy Rusk | Beyond Holo Hollow | after **Hold It Together** is completed |

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
