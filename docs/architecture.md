# Architecture

## Direction: modular monolith

RuneSpace starts as a **modular monolith**: one repository, one application, one database, one deployment, with strong internal boundaries. There are **no** microservices, no multi-repository layout, and no premature monorepo tooling.

The internal boundaries below are enforced by convention and directory layout, not by separate deployables. When a boundary genuinely needs to scale independently (background workers, isolated minigame runtimes), that is a later, explicit decision.

## Server-authoritative game model

The browser is **never** the trusted source of progression. Inventories, XP, rewards, and action outcomes are resolved by server-authoritative domain logic and persisted server-side. Clients send intent; the server validates, resolves, and stores the result.

This means:

- Game rules live in `game/domain/` and are called from `server/`.
- React components never compute or store authoritative state.
- Any client-side value (a minigame score, a displayed timer) is treated as untrusted until re-validated by the server.

## Boundaries and dependency direction

```
app/            routes, layouts, pages (thin composition)
  │ uses
components/     reusable visual primitives (presentational)
features/       vertical features (composition + wiring to server)
  │ uses
server/         orchestration, authorized commands, persistence, timers
  │ uses
db/             Drizzle schema, migrations, narrow persistence code
game/domain/    pure rules, calculations, state transitions, IDs
game/content/   typed content definitions (data-driven)
game/schemas/   Zod validation for content + request boundaries
```

Dependency rules:

- `app/`, `components/`, `features/` may depend on `server/`, `game/*`, `db/`.
- `server/` depends on `game/*` and `db/`; it does **not** import React.
- `game/domain/` and `game/content/` are framework-free (no React, no Next.js, no `pg`). They are the pure core.
- `game/schemas/` depends only on Zod and the ID contract.
- `db/` depends on Drizzle, the schema in `db/schema.ts`, and `server/env.ts`.
- `minigames/` are isolated client-side boundaries; they talk to the app only through small typed contracts (no shared mutable game state).

Lower layers never import higher layers. Domain logic never imports UI.

## Player-intent flow

1. Player interacts in `app/` / `features/` (UI only).
2. UI calls a server action or route handler in `server/`.
3. `server/` authenticates, loads data via `db/`, and calls pure rules in `game/domain/`.
4. Domain rules resolve the outcome from authoritative inputs (content from `game/content/`, validated by `game/schemas/`).
5. `server/` persists the result through `db/`.
6. UI reflects the server-confirmed state.

## Play orchestration

RuneSpace's application-wide play boundary is **Play**, not Mining. Mining was the first vertical, so the generic shell was originally embedded in the Mining feature; since Issue #127 it has been extracted to its own Play ownership.

- **Generic transaction/action lifecycle:** `server/action-resolution.ts` owns `withResolvedOwnedCharacter` / `withLockedOwnedCharacter`, the durable action cursor, locking, lazy resolution, and transition (continue/stop/replace) semantics. It knows nothing about Mining, Refining, Travel, or Welding.
- **Generic Play state assembly:** `server/play.ts` owns `createPlayResolver`, `PlayGameplayState`, and shared state assembly/refresh; `server/play-state.ts` owns the shared `loadPlaySnapshot` read. Play dispatches persistence by the original `context.action.actionId`, hands authoritative resolved Mining/Refining attempt counts to generic mission progress before the action cursor advances, and refuses composed persistence when the original action context is absent.
- **Activity-specific resolvers:** Mining (`server/mining.ts`), Refining (`server/refining.ts`), Travel (`server/travel.ts`), Welding (`server/welding.ts`), Fabrication (`server/fabrication.ts`), and Tinkering (`server/tinkering.ts`) each retain their own resolver implementation. Fabrication and Tinkering (#232) are deliberately their own authored boundaries — `game/domain/fabrication.ts`, `game/domain/manual-override.ts`, `game/domain/tinkering.ts`, with the shared hypothetical-inventory helper in `game/domain/working-inventory.ts` — not a generic crafting engine and not Refining variants; they reuse the one-active-action boundary, the shared bounded-run selection, the inventory planners, and the Mission framework rather than forking them. A started Fabrication workpiece's reservation is enforced by `server/fabrication-reservation.ts`, which every carried-item command that runs alongside an action calls. Leaf command modules (`server/mining-commands.ts`, `server/refining-commands.ts`, etc.) may depend on both their activity owner and the generic Play layer without creating cycles.
- **Accepted-trade command gate (#266):** the owned-character boundaries
  (`lockPlayableOwnedCharacter` in `server/action-resolution.ts`) refuse a
  trade-engaged character right after locking its row and before any
  reconciliation, via `assertNotTradeEngaged` (`server/player-trade-gate.ts`).
  It is deny-by-default: only the Play state read and the Scavenge reveal
  dismissal opt out with `allowDuringTrade`. See "Player trade requests and
  sessions" below.
- **Generic client Play shell:** `features/play/PlayContext.tsx`, `features/play/PlayScreen.tsx`, `features/play/PlayConsole.tsx`, and `features/play/command-gate.ts` own the Play context, shell composition, command gate, and boundary refresh. They compose every activity surface (Mining, Refining, Travel, Scavenging, Cargo Hold, Power Annex, missions, NPC interactions, location presentation) and host the shared Inventory/Equipment drawers.
- **Feature-specific UI stays feature-owned:** `features/mining/MiningActivity.tsx`, `features/refining/RefiningConsole.tsx`, `features/travel/*`, `features/cargo/*`, etc. remain owned by their feature. Mining-specific concerns such as Salvage Cutter / Power Cell boosting and run-panel collapse behavior are not Play concerns.
- **Inventory/Equipment are shared surfaces:** global surfaces and generic helpers live under `features/inventory/` rather than `features/mining/`. The carried-inventory mutation boundary lives in `server/carried-inventory.ts`.
- **RNG ownership is activity-local:** activity RNG implementations remain activity-owned (Mining RNG, Refining E2E RNG), while Play owns the default wiring so generic callers no longer import Mining merely to obtain a random source.
- **Server-authoritative state/reconciliation is unchanged:** the generic extraction is an ownership refactor; the browser remains untrusted and all progression resolves server-side in the locked action transaction.

See `docs/gameplay-foundations.md` for timing/progression/inventory contracts, `docs/missions.md` for the declarative mission framework, and `docs/npc-conversations.md` for the one canonical NPC conversation model (conversation hub, Mission-derived entries, and replayable topics).

### Play surfaces (Issue #145)

This section is the single source of truth for the player-facing Play surface
ownership. The detailed visual rules remain in the feature documents linked
below.

- **Location** is the stationary primary surface, composed by
  `features/location-scene/LocationSurface.tsx`. It owns the current-location
  scene, description, activity composition, and same-location population/profile
  flow through `LocationPopulationPanel`. Population browsing does not belong on
  Map.
- **Local Place** is a place inside the current World Location (issue #159),
  composed by `features/local-places/`. It is a variant of the Location surface,
  not a fourth surface: the footer gains no destination, the character's
  authoritative position never changes, and the open place lives in the `place`
  query parameter so refresh and Back behave sensibly. See
  `docs/gameplay-foundations.md` for the full contract.
- **Map** is the dedicated query-backed `?surface=map` surface, composed by
  `features/travel/LocalMapPanel.tsx`. It reuses the existing location
  geometry, route, selection, and explicit Travel confirmation behavior. Map is
  read-only exactly when authoritative `state.travelState` is present. If Travel
  resolves while the URL remains on Map, the same surface immediately clears
  transit treatment, enables ordinary stationary interaction, and changes Back
  to Location; there is no client latch for how Map was opened.
- **Journey** is the in-transit primary surface, composed by
  `features/travel/JourneyPanel.tsx`. Its status and feed are presentation only.
  The existing server-authoritative Travel state and `ScavengeControl` command
  remain the gameplay authority; Journey does not resolve, persist, or invent
  outcomes.
- The fixed Play footer has four destinations: **Character · Inventory · Map ·
  Missions**. Inventory and Equipment are two tabs in one shared overlay owned
  by `features/inventory/InventoryEquipmentPanel.tsx`; their existing
  server-authoritative command and projection boundaries remain unchanged.
  Character (#213) opens the current character's profile in the same shared
  overlay, owned by `features/characters/CharacterPanel.tsx`; account-level
  character selection stays at `/characters`, reached from that overlay's
  sticky Switch Character action.
- Character Level has exactly one definition, `1 + Σ(skillLevel - 1)`, in
  `game/domain/character-progression.ts` (#213). That module also decides which
  skills a progression surface presents — every skill in `SKILL_IDS` with an
  approved level curve and an approved player-facing name. The Character
  overlay, the same-location player inspector, and the location population list
  all read it; no component re-implements the formula or keeps a skill list.
  Character Level is derived, never persisted, and has no XP track of its own.
- Mission guidance continues to use the existing derived semantic targets on
  the primary surface. Issue #145 does not move or rewrite mission guidance.
  When its current target is an equipment item, the mission surface may open
  the shared overlay directly on Equipment through `PlayContext.openInventory`;
  the footer always calls the same entry point with the Inventory tab.
  Map does not gain MISSION or TURN IN markers; those destination/turn-in
  guidance semantics belong to Issue #143.

The composition is therefore `PlayConsole → Location | Map | Journey`, with
activity-specific controls and overlays remaining feature-owned. Since issue
#193 a stationary Location composes as the place, then its primary activity as
a sibling panel, then secondary systems; the activity carries its own compact
context and run summary. That grammar is owned by `docs/design-system.md`
("Stationary Location composition"). See also `docs/location-scenes.md` and
`docs/travel-map-design.md` for their surface-specific presentation rules.

## Realtime/social delivery (Issue #245)

Server → browser realtime delivery is **Server-Sent Events**. It is the one
substrate that chat (#246), Whispers (#247), and player trade requests (#266)
reuse; none of them opens its own transport. It is delivery and invalidation
only — never gameplay or social authority.

- **Mutations stay ordinary commands.** A chat send or trade response is an
  authenticated server action or route, validated and persisted like any other
  command. A delivery only prompts a browser to show or re-read durable state.
- **Contract:** `game/schemas/realtime.ts` is the single wire format shared by
  server and browser — the stream path, the ~25-second heartbeat (an SSE
  comment), the ~5-minute stream lifetime, the named frames (`ready`,
  `delivery`, `close`), the incremental frame parser, and the typed
  `RealtimeEventMap` registry. Each downstream domain registers its own
  namespaced event types there; #245 registers none, and the substrate imports
  no chat or trading model.
- **Publisher:** `server/realtime.ts` owns `publishRealtimeEvent(audience, type,
  data)` and the audience model (`character`, `account`, `everyone`, which
  may exclude named accounts — a public message skips its sender's blockers,
  #247). Alpha
  fanout is single-process and in-memory, anchored on `globalThis` so every
  route and action in the process shares it. A future multi-process deployment
  replaces only `createInMemoryRealtimeFanout`; there is deliberately no Redis,
  PostgreSQL LISTEN/NOTIFY, or durable event ledger. Publish only after the
  authoritative change commits.
- **Stream:** `GET /api/realtime?characterId=…` (`app/api/realtime/route.ts` →
  `server/realtime-stream.ts`). Every stream creation re-runs Better Auth and
  `requirePlayableOwnedCharacter`, and derives the delivery scope (account and
  character) from that authoritative row; the browser names only its active
  character and cannot choose rooms, locations, players, or accounts. The
  stream holds no lock or transaction, closes itself after its lifetime so the
  reconnect re-authorizes, and closes a client that falls too far behind.
- **Browser:** `features/social/realtime-connection.ts` reads the stream with
  `fetch` (so a 403 `GAMEPLAY_ACCESS_REQUIRED` stops and recovers to
  Characters instead of retrying), reconnects immediately after a deliberate
  close and with capped, jittered backoff after a failure, drops a half-open
  stream after two silent heartbeats, and reconnects at once when the network
  returns or the tab becomes visible (a resumed tab whose "live" stream missed
  a heartbeat is treated as dead, not trusted). One stream per open Play tab; there
  is no tab-leader election.
- **Reconciliation, not replay.** The stream carries no SSE `id:` and never
  replays. After every connect, reconnect, and tab resume the seam calls its
  `onReconcile` handlers, and each domain re-reads its durable state through
  its ordinary authoritative reads. A missed delivery never means lost state.
  Duplicate deliveries (several tabs, a delivery racing a reconcile read) are
  harmless because shell state is keyed by durable domain identity.
- **Chat/Social shell:** `features/social/SocialContext.tsx` is the seam
  downstream features consume — `subscribe`, `onReconcile`, the pinned
  actionable-card region (`upsertCard` / `removeCard`), and attention
  (`setAttention`). A pinned card counts toward the launcher's attention unless
  its owner marks it `attention: false` — a seen moderation notice stays pinned
  without lighting the launcher (#248). `ChatSocialSurface` is the content; today
  `ChatSocialDrawer` presents it as a Drawer over the current Play surface,
  opened by the `ChatSocialLauncher` that `GameShell`'s `floatingAction` slot
  pins to the right edge at a normalized `{ side, y }` position. Open state lives in the context, so a later docked
  desktop presentation can render the same surface without the launcher.
  Trade-request cards are domain-owned content placed in the pinned region,
  never chat messages and never gameplay-blocking modals.
- **Play is unchanged.** PlayContext's bounded boundary refresh still owns
  gameplay timers; the realtime seam never drives it.

Before any Coolify, Nixpacks, or proxy change, verify the minimal stream on the
real preview unchanged: signed in with a playable character, `/play/<id>`
shows the launcher's `data-realtime-status="live"`, and the browser's network
panel shows `/api/realtime` streaming `ready` then a `: keepalive` comment
about every 25 seconds, closing near 5 minutes and reconnecting. Also check
tab hide/show and a network drop. The response already sends
`cache-control: no-store, no-transform` and `x-accel-buffering: no`. Change
deployment configuration only when a failure is reproduced unchanged and
isolated to a deterministic proxy or configuration defect.

## Public chat: General and Trade (Issue #246)

General and Trade are the two game-wide public channels, built on the
realtime substrate above. There is no Local/Nearby/Zone channel.

- **Rules:** `game/domain/chat.ts` owns the content contract (trim, refuse
  empty, 280 code points, plain text), the shared send budget, the composer's
  pressure bands, and the promoted-ad cooldown. `CHAT_POLICY` there is the one
  home of every tunable number (length, page size, 90-day retention, the
  10-second window with General 5 / Trade 3, ad price and cooldown).
- **Contract:** `game/schemas/chat.ts` holds the request schemas, the
  `ChatMessageView` a viewer receives (no account identity ever leaves the
  server), and registers `"chat.message"` on `RealtimeEventMap` by module
  augmentation, so the substrate still imports no chat model.
- **Persistence:** `chat_messages` (`db/rune-space.ts`) holds one immutable row
  per successful send with the server-derived sender account, character, and
  name at send time. `seq` (an identity column) is the feed order and the
  "older than" cursor, so equal timestamps never skip or repeat a row. A
  promoted Trade ad is one `trade` row carrying the price it paid; the General
  feed reads it too. The row is also the send: the rolling window and the ad
  cooldown are read from it, never stored twice.
- **Commands and reads:** `server/chat.ts`. Every entry re-runs
  `requirePlayableOwnedCharacter`. A send (`sendChatMessageAction`,
  `postPromotedTradeAdAction`) takes a per-account transaction-scoped advisory
  lock, so every tab, device, and character of one account shares one
  serialized budget and one ad cooldown; content, the severe-term guardrail,
  the budget, the cooldown, and the Credit charge are all decided inside that
  transaction, and the charge and the row commit together or not at all. Only
  after commit does it publish `"chat.message"` to everyone. History is the
  `GET /api/chat` route. Both halves pass through a viewer seam: reads through
  `visibleToViewer` (in SQL, so pages stay full) and live deliveries through
  `publishChatMessage`. Block (#247) suppresses blocked senders at both,
  server-side, because no account identity reaches the browser. The send path
  itself — lock, prune, content, guardrail, budget — is `beginChatSend`, which
  Whispers share.
- **Retention:** each send deletes at most a bounded batch of rows older than
  90 days (`SKIP LOCKED`, so concurrent sends never contend), and reads never
  return expired rows even before they are pruned. No scheduler is needed.
- **Guardrail:** `server/chat-guardrail.ts` refuses a message containing a
  listed severe slur before persistence or delivery. It matches whole folded
  tokens only, keeps the list as SHA-256 digests, and records nothing about the
  sender; it is not a toxicity classifier or a sanction.
- **Browser:** `features/chat/PublicChat.tsx` renders inside the Chat/Social
  Drawer (Play composes it into `ChatSocialSurface`'s conversation region).
  `features/chat/chat-feed.ts` merges every source — latest page, older page,
  delivery, reconnect re-read — by message id in `seq` order, restarts from the
  latest page when a reconnect cannot reach what it holds, and counts the
  authoritative send budget down locally with no polling. General and Trade
  raise no attention or unread count.

## Whispers, Block, and Report (Issue #247)

1:1 Whispers, account-level Block, and player Report extend public chat and
the realtime substrate; they add no transport, route destination, or footer
item.

- **Identity:** player-facing identity is character-to-character; safety
  identity is the account underneath. Whisper participants, Blocks, and
  Reports store stable character and account ids, never names, so renames and
  character switching change nothing. A surface names its target by stable id
  (a chat sender) or by exact public name; `server/social-targets.ts` resolves
  both. A name is an exact match on the folded unique key, never a prefix,
  search, or directory. Opening a Whisper resolves names game-wide (the
  Whispers tab's "Start a Whisper" reaches any character, nearby or not,
  online or not); Block and Report by name keep the same-location profile's
  boundary.
- **Whispers:** `server/whispers.ts`. A Whisper is a `whisper` row in
  `chat_messages` bound to one `whisper_conversations` pair (unique
  `participant_key` of the two character ids), so it shares the immutable
  message contract, `beginChatSend` (the one account-wide budget: General and
  Whispers below 5, Trade below 3 on the same count), the severe-term
  guardrail, and 90-day retention. A conversation is created by its first
  Whisper, never by opening one. After commit, `"whisper.message"` goes to both
  participant characters; an offline recipient reads it from
  `GET /api/whispers/conversation` on return. Unread is durable per recipient
  character: `whisper_participants.last_read_seq`, and unread is derived (the
  other character's retained messages above it), never counted. Reading
  advances it (capped, never backwards) and publishes `"whisper.read"` to that
  character's other tabs, which re-read `GET /api/whispers`. General and Trade
  have no durable unread.
- **Block:** `server/player-blocks.ts`. `player_blocks` holds the current
  account pairs; `player_block_events` appends every block and unblock with
  both accounts, the characters involved, and the instant. A Block hides the
  blocked account's public messages from the blocker only (reads and live
  delivery), prevents Whispers in both directions, keeps prior history, and is
  never disclosed to the blocked account — its refused Whisper reads like any
  undeliverable one. `blockBetween` / `isBlockedBetween` are the seam trade
  requests (#266) reuse. A Block publishes `"safety.blocks"` to the blocker's
  own account only, so its other tabs restart their feeds.
- **Report:** `server/player-reports.ts`. `player_reports` is self-contained
  evidence: a message report binds the immutable message id (no foreign key,
  so retention cannot remove it) and snapshots the exact message plus up to 10
  before and 10 after from the same public feed or that one Whisper
  conversation, never another. One account reports one message once (a
  partial unique index); a player report keeps the character's name at report
  time. Report + Block commits both in one transaction. Nothing notifies the
  reported player, scores anyone, or sanctions anyone; #248 builds operator
  review on these rows.
- **Browser:** `features/chat/ChatContext.tsx` lives for the whole Play tab
  (the Drawer unmounts when closed): it owns the Drawer's view, the Whisper
  inbox and its unread attention on the launcher, the Block revision, and
  `startWhisper`, which opens a conversation inside Chat/Social from any
  character-facing surface without navigating. `ChatConversations` renders
  General, Trade, and Whispers as tabs; `SafetyFlow` is the one Block / Report
  / Report + Block flow used by message actions, Whisper conversations, and
  the same-location profile.

## Moderation (Issue #248)

Operator review, sanctions, appeals, and privileged-access audit sit on top of
Block and Report; `docs/moderation.md` is the contract.

- **Rules:** `game/domain/moderation.ts` (case statuses, sanction kinds and
  durations, derived sanction state, notices, appeals). Whether a sanction is
  in effect is always derived from stored facts and the request clock.
- **Enforcement seams:** a suspension is an input to `decideGameplayAccess`,
  loaded by `server/gameplay-access.ts`; a social restriction is refused in
  `beginChatSend` (every chat send) and by
  `requireTradeRequestInitiationAllowed`, which trade-request creation calls
  (#266). Both are account-wide.
- **Operator surface:** `server/moderation-commands.ts` (`requireAdmin`) over
  the internal `server/moderation-seams.ts`. Every sensitive read writes a
  `privileged_access_logs` row first (`server/privileged-access.ts`); every
  mutation writes an `operator_audit_logs` row with its case id.
- **Player surface:** `server/moderation-notices.ts` (session only, own
  account), `/moderation` pages, the Characters callout, and pinned
  "Moderation notice" cards in Chat/Social, refreshed by
  `"moderation.notices"`.

## Player trade requests and sessions (Issue #266)

The first slice of same-location player trading (#225's contract): durable,
authoritative requests and exclusive accepted sessions. Offers, Ready/Confirm,
settlement, and the economic audit are #267; every player-facing surface,
including the Chat/Social request cards, is #268.

- **Rules:** `game/domain/player-trade.ts`. `PLAYER_TRADE_POLICY` is the one
  home of the numbers (20-second request expiry, 4 requests per account per
  rolling 30 seconds, the same-recipient escalation threshold, 5-minute
  session inactivity). A request's and a session's effective state is derived
  from stored facts and the request clock — expiry, and either character
  leaving the request's World Location, apply on the next check with no job.
- **Persistence:** `player_trade_requests` holds one row per request the
  server created (refused attempts write nothing), so it is also the
  short-lived ledger for the budget and escalation; a partial unique index
  allows one stored `pending` row per requester. `player_trade_sessions` holds
  session identity and lifecycle (`active`, `canceled`, `expired`), and
  `player_trade_claims` — primary key `character_id` — holds each character's
  claim on its one active session, so no character can be in two sessions,
  same-account trades included. Derived outcomes are written down only when
  they matter: before a requester's outgoing slot or a character's claim is
  reused, and at acceptance; spent requests older than the rolling window are
  pruned on creation; an accepted request is kept as the link to its session.
- **Commands and reads:** `server/player-trades.ts` (create, cancel, decline,
  accept, session cancel, and `getTradeState` behind `GET /api/trade`). Every
  one requires gameplay access and proves the acting character is the right
  participant; a foreign, guessed, or ended id reads like a missing one.
  Creation locks the requester's row, then a per-account advisory lock, so
  one account's tabs, devices, and characters share one serialized budget; it
  reuses `resolveCharacterTarget`, `blockBetween` (a Block by the target reads
  like any unavailable target), and `requireTradeRequestInitiationAllowed`.
  Acceptance locks both characters' rows in id order, then — in one
  statement, in id order — every request row it may write, revalidates
  co-location, idleness, access, and Block, claims both characters, cancels
  the recipient's own outgoing request, and invalidates every other pending
  request involving either participant. Cancel, Decline, and session Cancel
  lock only their own row. Trade commands lock characters `FOR NO KEY
  UPDATE`: that still serializes with the gameplay boundary's `FOR UPDATE`,
  but not with the foreign-key checks another trade's inserts take, which
  would otherwise deadlock crossed requests. "Idle" means no
  `active_actions` row at all: a trade command never reconciles or stops the
  player's activity, so a finished-but-unresolved run still counts until
  Play resolves it.
- **Gate:** a character with an effectively pending outgoing request (sending
  one holds the requester idle) or an active claim is trade-engaged.
  `assertNotTradeEngaged` refuses it in the shared owned-character boundary
  (see Play orchestration) and before a promoted Trade ad's Credit charge; the
  refusal is an `OwnershipError` (409), so every gameplay handler already
  returns its message. Receiving a request never engages anyone. Because the
  gate runs under the character row lock and acceptance holds both rows, no
  command can slip between acceptance and the gate. When the gate finds a
  requester's request already lapsed, it writes the lapse down before the
  command runs, so a recipient who walks away and back cannot revive a
  request whose requester has since started something.
- **Realtime:** after commit, `"trade.request"` and `"trade.session"`
  (`game/schemas/player-trade.ts`) prompt both participant characters to
  re-read `GET /api/trade`. They carry an id and the change only.

## Where minigames fit

Phaser experiences live in `minigames/`, isolated from the main React tree. They communicate through small typed contracts; any progression result is server-validated. They are not part of this foundation issue.

## Strict TypeScript & SSOT

- Strict TypeScript is enabled project-wide (`tsconfig.json`, `strict: true`, plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`). The one `tsconfig.json` covers every committed `.ts`/`.tsx` file, including `tests/unit/`, `tests/integration/`, and the Playwright sources under `tests/e2e/`, so `pnpm typecheck` is the single strict-typing boundary.
- Single source of truth: every rule, identifier, content definition, and persistence shape has one home. Derived values are computed from authoritative inputs, not redundantly stored. See `AGENTS.md` and `docs/component-boundaries.md`.
- Equipment is one such home (#233): each item's equipment facts — which slot kind it fits, a container's Inventory slots, a Mining tool's level requirement, charge ceiling and effects — are authored once on its item entry and resolved through `getEquipmentDefinition` (`game/config/balance.ts`). Equipment, Mining, Tinkering's last-Cutter guard, Power Cell loading, and every presentation of charge consume that boundary; none branches on a particular item ID. It is two closed kinds, not an item-effect scripting engine (`docs/gameplay-foundations.md`, "Equipment definitions").

## Current status

RuneSpace is a **playable pre-alpha** under active development. The generic Play shell is live and composes the connected early-game loop: Travel/Scavenging, Ferrite Shale Mining at The Jag, Refining at the Abandoned Processing Yard, Welding/Cargo Hold repair at Crash Site, Inventory/Equipment, locations and Power Cells/Power Annex, the Holo Hollow settlement with Local Places, character-scoped Credits, and merchant Trade at both a Local Place (Bix) and a World Location (Wade at Rusk Recovery), repeatable Practice Welding with its Clean Pass opportunities, Work Orders, Deep Jag, Fabrication through level 8 with Manual Override and Tinkering at Rusk Recovery's Fabrication Station (#232, #233), two Mining tools and three containers resolved through one equipment-definition boundary (#233), NPC conversations, and the declarative mission framework (Walk It Off / Cut Your Teeth / Waste Not / Hold It Together / Keep the Change / 10,000 Hours / 10,001 Hours / Return the Favor / Break It Down / Brace Yourself / A Cut Above, plus Out of the Weather and Cutting Costs). The architecture beyond this vertical slice — additional skills, quests, hex exploration, multiplayer, and minigames — remains scoped to future approved issues.
