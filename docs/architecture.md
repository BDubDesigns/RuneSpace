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
- **Feature-specific UI stays feature-owned:** `features/mining/MiningActivity.tsx`, `features/refining/RefiningConsole.tsx`, `features/travel/*`, `features/cargo/*`, `features/ship/*`, `features/site-stash/*`, etc. remain owned by their feature. Mining-specific concerns such as Salvage Cutter / Power Cell boosting and run-panel collapse behavior are not Play concerns.
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
- Below 1280px the fixed Play footer has four destinations: **Character ·
  Inventory · Map · Missions**; at 1280px and wider the desktop workspace
  replaces it (see "Desktop workspace and utility presentation" below).
  Inventory and Equipment are two tabs in one shared overlay owned
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

### Desktop workspace and utility presentation (Issue #286)

At `min-width: 1280px` Play is a second composition of the **same** shell, not a
second page. `GameShell` takes one optional `desktopRail` slot and places it with CSS only: a
24rem sticky, full-height right rail beside the main column, and no bottom
navigation or floating launcher. Below 1280px the slot renders nothing and the
shell is the phone/tablet composition it has always been, which
includes the roughly 1024px laptop width (no cramped forced dock).

- **One mounted instance, decided by state, not hidden by CSS.**
  `useDesktopWorkspace()` (`features/play/workspace-presentation.ts`) answers
  `true`, `false`, or `undefined` until the browser has answered. Anything
  interactive that exists in both compositions mounts in exactly one place at a
  time: the Current Missions strips (`PlayConsole` below 1280px, the rail above
  it) and each utility (modal Drawer below, docked panel above). While the
  answer is `undefined` — the server render and hydration — the dock mounts
  nothing, and the phone placement of the strips is hidden by CSS at `xl`.
  `DESKTOP_WORKSPACE_MIN_WIDTH_PX` in `features/play/utility-workspace.ts` is the
  one constant for the JS query; Tailwind's `xl` and the Map destination
  panel's media query in `app/globals.css` are the same 1280px, and a unit test
  pins them together.
- **One logical open intent.** `PlayContext.openUtilityId` is the single
  explicitly opened utility (`chat | inventory | character | missions`). The
  existing `characterOpen` / `inventoryOpen` / `missionsOpen` flags and their
  setters are views of it, and `SocialProvider` takes its `open` from it, so
  opening one utility closes the others by construction: no competing invisible
  Drawer or focus trap, on any width. Callers that open a utility from
  elsewhere (the Equipment shortcut, a Whisper started from a message, a trade
  taking the screen) keep calling the same functions.
- **The presentation seam is `components/ui/UtilitySurface.tsx`.** `"modal"` is
  the shared `Drawer` exactly as before (portal, `aria-modal`, scroll lock,
  Escape, focus trap, focus return). `"docked"` is an ordinary tab-panel region:
  no `aria-modal`, backdrop, portal, scroll lock, Escape handling, or trap.
  Inventory/Equipment, Character, the Mission Log and Chat/Social each render
  the same content through it (`InventoryEquipmentPanel`, `CharacterPanel`,
  `MissionLogPanel`, `features/social/ChatSocialPanel.tsx`), so a new ordinary
  nonblocking utility reuses the seam instead of adding a desktop overlay.
  `features/play/PlayUtilityWorkspace.tsx` is the coordinator: it reads the open
  intent and the viewport and mounts the one presentation of the one utility.
- **Exclusive interactions stay foreground modals at every width.** An accepted
  player trade (`PlayerTradeSurface`), the non-dismissible
  `ScavengeRevealOverlay`, destructive confirmations and the portrait chooser
  are not utilities and are never constrained to the rail. While a trade
  session is open the dock does not leave the passive home mounted underneath
  it. Migrating ordinary NPC conversation and merchant presentation onto the
  seam is a follow-up, not part of this slice; their behaviour is unchanged.
- **Desktop home.** Chat is the home until the player chooses **Set as
  default** on another utility; opening Inventory or Missions never changes it,
  and **Back to {home}** returns to it. The choice is presentation only, kept
  per character in this browser (`runespace:play-home-utility:<characterId>` in
  `localStorage`, with an in-memory fallback when storage is refused); an
  unrecognised value falls back to Chat and there is no account or database
  state. Choosing the home tab is the passive state (no open intent), and an
  open intent that names the home (an in-Chat action while Chat is the home, the
  Equipment shortcut while Inventory is) settles back to it, so shrinking to a
  phone never raises a modal the player did not ask for, while an explicitly
  opened non-home utility becomes the matching Drawer and back, with focus moved
  into the Drawer or onto its docked tab.
- **Chat's state lifetime.** Chat is not hidden while another utility is up; it
  is unmounted, so a hidden Chat cannot read anything. Unsent drafts live in
  `ChatProvider` (`features/chat/chat-drafts.ts`, a ref-backed store, so typing
  re-renders nothing else) and survive every switch and breakpoint crossing; a
  send that finishes after its surface unmounted still spends its draft
  (`settle`), so the sent text cannot come back and go out twice.
  The single realtime stream, the Whisper/System/mention state and the pinned
  cards stay in `SocialProvider`/`ChatProvider`, above all of it, so utility
  switches and Map/Travel refreshes never reconnect it. "Seen" decisions read
  `SocialContext.surfaceVisible` (the Chat surface is mounted, docked or
  modal) rather than the open intent, since a passive home is visible with no
  intent at all. The Chat tab carries the attention count in its accessible
  name, as the phone launcher does, so a pinned trade request is never out of
  sight just because Inventory is the open utility.
- **Objectives and Map.** `MissionObjectivesRegion` bounds the authoritative
  `MissionGuidanceStrips` for the rail: nothing at all with no pinned active
  Mission (#325), a height cap that scrolls inside itself, and a collapse
  control when several are pinned (collapsing unmounts the strips). The Map control is a
  Play-only Location | Map slide switch (`PlayViewSwitch`) in the global top bar,
  left of News and Sign out, and opens the same `?surface=map` surface (there is no
  second Map), and while Map shows it is the one return control (the panel
  drops its own Back at desktop width); Map ↔ Location swaps only the main
  column.

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
  #247, who each get the redacted form on their `account` instead, #261). Alpha
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
  without lighting the launcher (#248). `ChatSocialSurface` is the content;
  `ChatSocialPanel` presents it through `UtilitySurface` (#286): a Drawer over
  the current Play surface below 1280px, opened by the `ChatSocialLauncher` that
  `GameShell`'s `floatingAction` slot pins to the right edge at a normalized
  `{ side, y }` position, or the docked Chat tab of the desktop rail above it.
  The open intent is Play's single open utility (passed to `SocialProvider` as a
  controlled `open`), and `surfaceVisible` says whether the surface is mounted.
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
  `GET /api/chat` route. Both halves pass through a viewer seam: reads select
  `blockedByViewer` per row (in SQL, so every viewer pages the same rows and
  cursors) and live deliveries go through `publishChatMessage`. A Block (#247)
  redacts the blocked sender's rows for the blocker at both (#261): the row
  keeps its place as a `RedactedChatMessageView` — id, `seq`, which feeds it
  occupies, sender name at send, and time, built from an allow-list — and its
  body, ad text, mentions, and sender id never leave the server for that
  viewer, because no account identity reaches the browser to filter on. The send path
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
  authoritative send budget down locally with no polling. Ordinary General and
  Trade messages raise no attention or unread count; only an `@mention` does
  (below).

### Public System messages (Issue #308)

General also carries automatic **System** lines — today only a Mining RARE FIND
announcement (`docs/gameplay-foundations.md`, "Secondary Finds"). They are a
first-class kind of row in the one durable timeline, not a fake player.

- **Persistence:** `chat_messages.kind` is `player` or `rare_find`. A System row
  has *no* sender account, character, or name, and a check constraint makes that
  a database fact (the three sender columns are null exactly when `kind` is not
  `player`; System rows are `general` only). No System account or character is
  ever created. `asPlayerChatMessage` (`db/rune-space.ts`) narrows a row to a
  player's message where a sender is required, and throws if it is not one.
- **Seam:** `server/public-system-messages.ts` is the one place that writes and
  shapes them. `recordRareFindAnnouncement` runs inside the caller's
  transaction — Mining's resolution persist — so the item, the XP, the run
  history and the announcement commit or roll back together. Live delivery is
  queued with `afterCharacterCommandCommits`, so nothing is published for a
  rolled-back find and a missed delivery is recovered by the ordinary history
  read.
- **Contract:** `SystemChatMessageView` (`system: true`, `treatment`) is a third
  member of `ChatMessageView`. It carries no sender id and no mentions. It is
  never redacted (it belongs to no account a viewer could have blocked) and is
  delivered to everyone.
- **Not a send:** the rolling send budget and ad cooldown read only rows with a
  sender account, so a System line spends nobody's budget. It creates no
  `@mention`, shows no Whisper / Report / Block, and is not reportable
  (`reportMessage` refuses it; report context and retained-chat views read
  player messages only).
- **Eligibility is authored,** per source and per find entry
  (`MiningSecondaryFindBalance.announce`), never inferred from rarity. The line
  reads "{character name} just found {item} at {location}!" with the character's
  name, never the account's, and is created when the find commits, with the
  time of that commit.

### Public `@mentions` (Issue #261)

- **Identity:** a mention targets a stable character. The composer's `@`
  list (`features/chat/mention-draft.ts`, `ChatComposer`) offers only
  characters already in view — recent senders in either feed and Whisper peers
  by id, Nearby Players (`GET /api/location-population`) by exact name — never
  a directory. Choosing one inserts `@Name` and records the target; the send
  names those targets (`mentions`, at most `CHAT_POLICY.maxMentions`).
  Hand-typed `@Name` text is plain text.
- **Resolution:** inside the send transaction, after `beginChatSend`,
  `resolveMentions` resolves each target with `resolveCharacterTarget` (an id
  anywhere, a name only at the sender's location) and requires another
  account's character whose *current* name the body shows after `@`
  (`mentionSpans` in `game/domain/chat.ts`, which the composer and renderer
  share: exact, ending at a word boundary, and each `@` going to the longest
  resolved name, so `@Alice` never mentions `Al`). Anything else refuses the
  whole send as `invalid_mention`, before any ad charge; mentioning an account
  the sender blocked is `blocked_by_you`. A target whose account blocked the
  sender is accepted, stored already read, and never alerted, so the Block is
  not disclosed and an Unblock never surfaces it.
- **Persistence:** `chat_message_mentions` rows (message, character, account,
  name at send, `read_at`) commit with their message and cascade with it
  under retention. A message is still one canonical row and one send; a
  promoted ad's mentions follow the same rules.
- **Attention:** derived, never counted: `readChatMentions` (`GET
  /api/chat/mentions`) counts the character's unread mentions on retained
  messages per feed (an ad counts in both, once in the total), excluding any
  whose sender and target accounts have a Block either way. A new Block
  (`recordBlock`) also marks every unread mention between the two accounts
  read, both ways, so lifting it never brings silenced attention back. `markChatMentionsRead` marks the
  character's mentions in one feed through the `seq` a tab showed and
  publishes `"chat.mentions.read"`; a send publishes `"chat.mention"` to each
  unblocked target. Both are invalidations; `ChatContext` re-reads on them,
  on reconnect, and on Block changes, and feeds a third launcher attention
  source (`mentions`) and the General/Trade tab badges.

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
  have no durable unread of their own; only `@mentions` do (#261).
  **Hide** (#261, `hideWhisperConversation`) sets this side's
  `whisper_participants.hidden_through_seq` to the newest `seq` its tab showed
  (capped) and advances `last_read_seq` to it; the inbox omits the
  conversation until a newer message exists from either side, and
  `openWhisper` clears the marker. No message, the other side's row, Report
  evidence, or moderation access is touched.
- **Block:** `server/player-blocks.ts`. `player_blocks` holds the current
  account pairs; `player_block_events` appends every block and unblock with
  both accounts, the characters involved, and the instant. A Block redacts the
  blocked account's public messages for the blocker only — placeholders in
  place, reads and live delivery (#261) — suppresses `@mention` attention both
  ways, prevents Whispers in both directions, keeps prior history, and is
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

## System recipe-unlock notices (Issue #274)

A read-only **System** conversation in Chat/Social → Whispers tells a character
which recipes a level crossing just unlocked. It deliberately reuses Whisper
*presentation* and none of Whisper *identity*: System is not a player, so there
is no fake account or character, no `chat_messages` row, no conversation pair,
and nothing to reply to, Block, Report, or open a profile for.

- **Derivation:** `game/domain/recipe-unlocks.ts`. A crossing from
  `previousLevel` to `level` unlocks every recipe in the skill's canonical
  registry (Refining and Fabrication today) whose `minimumLevel` lies in
  `(previousLevel, level]`. There is no notification-specific list: authoring
  a recipe normally is all a future recipe needs. A notice names a recipe by
  its output's item presentation, adding its inputs only when another recipe
  of the same skill makes the same output ("Slag from Galvanite").
- **Writer and atomicity:** `grantCharacterSkillXp` (`server/progression.ts`),
  the one gameplay XP boundary, inserts at most one grouped
  `recipe_unlock_notices` row per award, in the transaction that commits the
  XP — both commit or neither does. The level transition is the only state
  boundary: no sent flag, no per-recipe ledger, and the character row lock
  serializes awards, so a crossing is written exactly once. The operator's SET
  TOTAL XP repair never calls the grant, so it writes no notice.
- **After commit:** the grant queues its `"system.notice"` prompt with
  `afterCharacterCommandCommits` (`server/action-resolution.ts`). The shared
  character command boundaries run queued effects only once their transaction
  has committed and drop them on rollback; a transaction opened outside them
  queues nothing. This is a post-commit prompt hook, not an event bus or
  outbox: durable rows stay the only truth, and clients reconcile.
- **Read side:** `server/system-notices.ts` behind `GET /api/system-notices`
  and `markSystemNoticesReadAction`. A notice stores the recipes' action IDs,
  never their names; the body is rendered from current presentation when
  read. `read_at` is set once, so a read notice never re-lights, and reading
  publishes `"system.read"` to the character's other tabs. Notices are not on
  the chat retention sweep.
- **Browser:** `ChatContext` holds the System inbox beside the Whisper inbox
  and feeds a second attention source (`system`) and the Whispers tab badge.
  `WhisperPanel` pins the System row above player conversations and opens a
  read-only view with no composer.
- **Identity:** `SYSTEM_IDENTITY_NAME` and `isSystemIdentityName` in
  `game/domain/player-name.ts` are the one rule; `validatePlayerName` and
  `validateCharacterName` both refuse a whole name that folds to System (see
  `docs/authentication.md`).

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
settlement, and the economic audit are #267 (next section); every
player-facing surface, including the Chat/Social request cards and the trade
composition UI, is #268 ("Player trading experience" below).

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
  request whose requester has since started something. Since #267 it does the
  same for a claimed session past its inactivity expiry (locking the session
  row after the character row), so a final Confirm already waiting on the
  locks cannot settle a trade whose characters were released.
- **Realtime:** after commit, `"trade.request"` and `"trade.session"`
  (`game/schemas/player-trade.ts`) prompt both participant characters to
  re-read `GET /api/trade`. They carry an id and the change only.

## Player trade offers, settlement, and audit (Issue #267)

The authoritative settlement engine behind an accepted session. There is no
player-facing trade UI in this slice; the commands are server actions and
the state is part of `GET /api/trade`. #268 (next section) is the UI.

- **Rules:** `game/domain/player-trade.ts` owns the consent model (`compose`
  until both participants are Ready, then a frozen `review`) and the offer
  validators (whole non-negative Credits within balance, positive whole stack
  quantities). `game/domain/player-trade-settlement.ts` is the pure settlement
  planner: it re-proves both offers against both characters' loaded state and
  plans each side's outgoing removals and incoming additions as one
  hypothetical post-trade state through the existing inventory planners
  (`game/domain/working-inventory.ts`) and `deriveEquipmentLoadout`, so stack
  merging and limits count, a full Inventory can complete a one-for-one swap,
  and a container received in the trade adds a slot and mass but no capacity
  (only equipped containers do, and equipped items are never offerable). A
  trade is refused when it would push a side's slots or mass past capacity —
  or further past it — or take a side from at least one usable Mining Cutter
  to none, counted across Equipment, carried Inventory, the Cargo Hold, and any
  site stash (#284) by
  that character's own Mining level (`usableMiningCutterCount`, the same count
  Tinkering's last-Cutter guard uses). These rules are deliberately "never make
  it worse": a character already over capacity from elsewhere may still trade
  in a way that reduces the problem without curing it, and one that already
  has no usable Cutter may still trade other things, so trading never traps a
  character in an already-invalid state. Settlement also proves every
  post-trade Credit balance fits `MAXIMUM_CHARACTER_CREDITS` (the PostgreSQL
  `integer` behind `characters.credits`), and a trade in which neither side
  offers anything is never committed or audited; a one-sided gift is.
- **Offers:** only carried Inventory is offerable. A participant may set its
  own Credits and add or remove its own carried stack quantities and carried,
  unequipped, non-Cargo, non-stash unique instances; the browser names an id and a
  quantity, never an owner, balance, location, or item state. Offers are
  state, not escrow: nothing leaves a character before commit. Credits and
  consent live on `player_trade_sessions`; stack and unique lines live in
  `player_trade_offer_stacks` and `player_trade_offer_items` (no foreign key to
  `item_instances`, so an ended session's lines never constrain the instance).
- **Version and consent:** `offer_version` is server-owned. Every offer
  command names the version it acts on and applies only to that exact current
  version; a stale, replayed, malformed, foreign, or nonparticipant command is
  refused before anything is written, so it never advances the version, clears
  consent, or moves anything. A valid edit advances the version and clears
  both participants' Ready and Confirm (one write, `advanceOffer`). Ready and
  Confirm record consent on the current version without changing it; Ready is
  refused while both offers are empty. Setting Credits to the amount already
  offered is a no-op — no new version, no cleared consent, no prompt. Change
  Offer leaves Ready or the frozen review, advancing the version. CHECK
  constraints keep Confirm impossible without both Ready and `completed`
  impossible without both Confirmed.
- **Serialization:** every offer command locks both participants' character
  rows in id order, then the session row — the order every trade command
  uses — so edits, Ready, Change Offer, Confirm, and Cancel on one session are
  totally ordered. An expired session is written down (`expired`) by the first
  offer command or gated gameplay command that finds it; valid commands
  refresh `last_activity_at`, never moving it backwards.
- **Settlement:** the second Confirm settles in its own transaction under
  those locks: it rechecks co-location at the session's World Location,
  idleness, the counterpart account's gameplay access, and Block, then loads
  both characters' inventories under lock and plans. A refusal moves nothing,
  clears all consent, and returns the session to `compose` on a new version
  with a reason naming whose side failed. Success applies Credits, each side's
  carried-stack diff (`applyCarriedStackDiff` in `server/carried-inventory.ts`),
  and each unique instance's change of owner — the same row, id, and mutable
  state such as Cutter charge — then marks the session `completed`, releases
  both claims, and writes the audit row, all in that one transaction. A
  repeated Confirm after completion answers with the completed trade; a
  Cancel that loses the race is inert; a Cancel that wins leaves the Confirm
  nothing to settle.
- **Audit:** `player_trade_audits`, keyed by the trade (session) id, so one
  trade can never have two rows. It preserves both explicit offers (Credits,
  stack item ids and quantities, unique instance ids with item ids), both
  accounts, both characters, the World Location, and the commit instant, and is
  written only by settlement in the settlement transaction: if the insert
  fails, nothing moves. It is permanent for alpha operational review, has no
  update or delete path, and is read through `server/player-trade-audit.ts` by
  trade id, account, or character. Those reads are internal seams; an operator
  surface that exposes them must record privileged access.
- **Realtime:** `"trade.session"` gains `updated` (either offer or either
  participant's consent changed) and `completed`, published to both
  participants after commit; a refused command publishes nothing.

## Player trading experience (Issue #268)

The player-facing slice on top of #266 and #267. It adds no trade rule: every
control asks a #266/#267 server action, and the browser renders only what
`GET /api/trade` and the command answers say.

- **Client state:** `features/player-trade/PlayerTradeContext.tsx`
  (`PlayerTradeProvider`, mounted in `PlayScreen` inside `SocialProvider` and
  `ChatProvider`) is the one owner of a tab's trade state. It re-reads on
  mount, on the shared stream's reconcile (connect, reconnect, resume), on
  each `"trade.request"` / `"trade.session"` prompt, on `"safety.blocks"`, and
  just after the next pending request or idle session would lapse (lapses are
  derived and published by no one). Reads and command answers apply
  newest-issued-first, so duplicate, late, or missed deliveries are harmless.
  Realtime is never the ledger; a request's realtime `change` only words the
  requester's note.
- **Surfaces:** the profile row (`CharacterProfilePanel` +
  `ProfileTradeAction`) leads with **Trade**, by public name, and shows
  Waiting + Cancel Request in its place. Incoming requests are pinned
  Chat/Social cards keyed `trade-request:<id>` (`TradeRequestCards.tsx`) that
  light the launcher; the requester's own pending request is a quiet
  `trade-outgoing:<id>` card. **Decline & Block** reuses `SafetyFlow`'s Block
  confirmation, then declines. The accepted trade is `PlayerTradeSurface`, a
  non-dismissible `Drawer` (`size="full"`) with a footer of primary actions;
  starting a session closes Chat/Social, Inventory, Character, and Missions,
  and a completed trade asks Play to re-read Inventory and Credits. Every
  session command names the offer version the surface rendered. `Drawer`
  keeps a stack of open Drawers and only the newest one traps focus and
  handles Escape, so the trade surface can open over a feature-owned Drawer.
- **Durable outcomes:** `TradeStateView.ended` is the character's latest
  session once it has ended (completed, canceled — and by whom — or expired),
  with exactly what a completed trade moved, read from its audit row (an
  item's state is included only while the character that received it still
  holds it). The client shows it only for the session that tab was
  displaying, so a missed `completed` prompt still converges on the same
  result.
- **Refused settlement:** `player_trade_sessions.settlement_refusal` and
  `settlement_refusal_side` (migration 0037) record why the latest final
  Confirm could not settle and whose side failed; `advanceOffer` writes them
  with the refused settlement's new version and clears them on every other
  offer change and at completion. The session view renders it per
  participant (`settlementRefusal`), so the first confirmer also learns what
  to correct; the surface shows it only while that participant is composing,
  and a refused final Confirm adds no second copy of it.
- **Reads after commit:** `ended` and counterpart Player names are filled in
  by `completeTradeState` after a command's transaction commits (and on
  `GET /api/trade`), so they add nothing to the row locks trade commands and
  the gameplay gate serialize on.
- **Identity:** trade counterparts carry their owner's public Player name.
  The character profile carries `sameAccount`, compared by account id on the
  server; a same-account profile shows Trade without Whisper, Report, or
  Block.

## Item sources (Issue #326)

"How can I get this item?" is answered by one projection, `resolveItemSources`
in `game/domain/item-sources.ts`, keyed by item ID. It is a **projection, not a
registry**: it holds no recipe, price, location or chance of its own and joins
the content that already owns each way of getting an item.

| Source | Derived from |
| --- | --- |
| Fabricate / Refine | `fabricationRecipes()` / `refiningRecipes()` in `game/config/balance.ts` |
| Mine (primary and Secondary Find) | `miningSources()` and each source's `secondaryFinds` |
| Buy | `MERCHANTS` (what the merchant **sells** to the player; buying from the player is not a source) |
| Daily claim | `POWER_ANNEX_CLAIM` in `game/domain/power-annex.ts`, which `server/power-annex.ts` also reads |
| Scavenge | `SCAVENGE_OUTCOMES` (qualitative only: no odds are exposed) |
| Player trade | `isItemTransferable` in `game/domain/player-trade.ts` |

- **Location** is never authored on a recipe: an action's host comes from
  `locationsOfferingAction` (`game/domain/location-state.ts`) over the
  character's already-resolved `locationStates`, joined by action ID. Refining
  is hosted by its console action, so every recipe takes that location.
- **Discovery versus capability.** A source the character has not been shown
  (the Fabrication Station before its Mission is accepted, a merchant before
  theirs, a mine that exists only in a location's opened state) is **omitted**,
  never hinted at. A source they know of but cannot use (a recipe above their
  skill level) is **listed locked** with its concrete gate. Order: usable, then
  the occasional walking find, then locked, then player trade.
- **Transferability** is the one item-level rule, `isItemTransferable`: whether
  this item type may take part in a player trade in principle. The offer
  commands, the settlement planner, the trade surface's offerable lists and the
  reference all ask it; where a copy of the item is (equipped, Cargo Hold,
  stash, carried) stays a separate per-character check.
- **Not acquisition sources:** Mission and dialogue rewards, admin grants, a
  failed Refining attempt's byproducts, Practice Welding's Slag, Tinkering's
  recovered Scrap and Work Order payouts. The module imports none of them, and a
  unit test pins that.
- **Where it runs.** Pure and client-importable: `features/item-sources/`
  derives the character's facts from the Play projection already on screen
  (`itemSourceFactsFromState`) and presents them through `ItemSourcesDetails`,
  `ItemSourcesDrawer` and the compact `ItemSourcesButton`. There is no route,
  persistence or per-item payload. Recipe ingredients drill down through the same
  surface, and an item already on the drill-down path is not offered again.
- **Entry point.** The Mission Log (`docs/missions.md`, "Item sources in the
  Mission Log"). Inventory details, recipe rows and Wiki links can reuse
  `ItemSourcesButton` later. The public Wiki keeps its hand-written tables.

## Where minigames fit

Phaser experiences live in `minigames/`, isolated from the main React tree. They communicate through small typed contracts; any progression result is server-validated. They are not part of this foundation issue.

## Strict TypeScript & SSOT

- Strict TypeScript is enabled project-wide (`tsconfig.json`, `strict: true`, plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`). The one `tsconfig.json` covers every committed `.ts`/`.tsx` file, including `tests/unit/`, `tests/integration/`, and the Playwright sources under `tests/e2e/`, so `pnpm typecheck` is the single strict-typing boundary.
- Single source of truth: every rule, identifier, content definition, and persistence shape has one home. Derived values are computed from authoritative inputs, not redundantly stored. See `AGENTS.md` and `docs/component-boundaries.md`.
- Equipment is one such home (#233): each item's equipment facts — which slot kind it fits, a container's Inventory slots, a Mining tool's level requirement, charge ceiling and effects — are authored once on its item entry and resolved through `getEquipmentDefinition` (`game/config/balance.ts`). Equipment, Mining, the last-Cutter guards of Tinkering and player-trade settlement (#267), Power Cell loading, and every presentation of charge consume that boundary; none branches on a particular item ID. It is two closed kinds, not an item-effect scripting engine (`docs/gameplay-foundations.md`, "Equipment definitions").

## Current status

RuneSpace is a **playable pre-alpha** under active development. The generic Play shell is live and composes the connected early-game loop: Travel/Scavenging, Ferrite Shale Mining at The Jag, Refining at the Abandoned Processing Yard, Welding/Cargo Hold and Landing Gear repair at Crash Site, character-owned site stashes at four activity sites (#284), Inventory/Equipment, locations and Power Cells/Power Annex, the Holo Hollow settlement with Local Places, character-scoped Credits, and merchant Trade at both a Local Place (Bix) and a World Location (Wade at Rusk Recovery), repeatable Practice Welding with its Clean Pass opportunities, Work Orders, Deep Jag, Fabrication through level 8 with Manual Override and Tinkering at Rusk Recovery's Fabrication Station (#232, #233), two Mining tools and three containers resolved through one equipment-definition boundary (#233), NPC conversations, and the declarative mission framework (Walk It Off / Cut Your Teeth / Waste Not / Hold It Together / Keep the Change / 10,000 Hours / 10,001 Hours / Return the Favor / Break It Down / Brace Yourself / Wheel Be Right Back / A Cut Above, plus Out of the Weather, Cutting Costs and Curly Must-Stash). The architecture beyond this vertical slice — additional skills, quests, hex exploration, multiplayer, and minigames — remains scoped to future approved issues.
