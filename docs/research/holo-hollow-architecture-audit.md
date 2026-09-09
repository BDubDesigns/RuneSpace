# Holo Hollow Foundation — Implementation Architecture Audit

**Status: Non-normative research — owner review required.**

| Field | Value |
| --- | --- |
| Audit base | `origin/main` @ `bb8e1956ab2edf3c30facb9c3c2c5df479b57df4` (`docs: codify Holo Hollow settlement and economy design (#158)`) |
| Date | 2026-09-08 |
| Branch | `research/holo-hollow-architecture-audit` (created from that SHA; no other changes) |
| Kind | Read-only implementation research. No runtime code, configuration, schema, migration, data, issue, or existing documentation was changed. |

## 1. Status and audit base

### 1.1 What this document is and is not

- `docs/holo-hollow.md` contains the **approved product/design decisions** for Holo Hollow. This audit treats every decision in it as a requirement, not as a proposal to redesign.
- The **current shipped implementation on `main` remains authoritative for existing behavior**. Where this document describes current code, it describes what was inspected at the SHA above; the code, not this description, is the source of truth.
- This document contains **implementation research and recommendations only**. It records where the approved foundation fits the architecture RuneSpace actually has today, what is genuinely new, what is a small extension, and what should be avoided.
- **Nothing in this document becomes approved architecture merely by appearing here.** Canonical architecture lives in `docs/architecture.md`, `docs/component-boundaries.md`, `docs/gameplay-foundations.md`, `docs/missions.md`, `docs/location-scenes.md`, and `docs/travel-map-design.md`. Any recommendation below that the owner accepts must be carried into those documents and into an approved issue before it is implemented.

### 1.2 Conclusion labels used below

Every architectural conclusion is tagged with exactly one of:

- **Reuse unchanged** — the existing boundary already does what the foundation needs.
- **Small extension** — an existing module/type/schema gains a narrow, additive field, branch, or prop; no new ownership boundary.
- **New boundary** — a genuinely new content registry, domain rule, schema, persistence shape, or server command is required and has no existing home.
- **Avoid for now** — a plausible abstraction that the approved slice does not need and that would be premature.

### 1.3 Documents inspected in full

`AGENTS.md`, `docs/holo-hollow.md`, `docs/architecture.md`, `docs/component-boundaries.md`, `docs/game-rules.md`, `docs/gameplay-foundations.md`, `docs/missions.md`, `docs/location-scenes.md`, `docs/travel-map-design.md`, `docs/testing-strategy.md`, `docs/deployment-database.md`. Targeted sections of `docs/development-workflow.md`, `docs/qc-studio.md`, and `docs/audits/pre-mission-framework-architecture-audit.md` (as the prior audit format precedent).

### 1.4 Code inspected in full

Content/schema/config: `game/config/foundations.ts`, `game/config/balance.ts`, `game/schemas/ids.ts`, `game/schemas/locations.ts`, `game/schemas/gameplay.ts`, `game/content/locations.ts`, `game/content/npcs.ts`, `game/content/conversation-backgrounds.ts`, `game/content/item-presentation.ts`, `game/content/travel-flavor.ts`, `game/content/missions.ts` (types and validation surface), `game/content/dialogue.ts` (beat/sequence types and the router).

Domain: `game/domain/inventory.ts`, `game/domain/equipment.ts`, `game/domain/missions.ts`, `game/domain/travel.ts`, `game/domain/character-profile.ts`.

Persistence: `db/rune-space.ts`, `db/schema.ts`, `db/index.ts`, `drizzle/0004_persistent_locations_travel.sql`, `drizzle/0012_curious_nighthawk.sql`, `drizzle/0016_waste-not-mission-progress.sql`, `drizzle/meta/_journal.json` (tail).

Server: `server/action-resolution.ts`, `server/play.ts`, `server/play-state.ts`, `server/carried-inventory.ts`, `server/inventory.ts`, `server/power-annex.ts`, `server/cargo-hold.ts`, `server/cargo-repair-access.ts`, `server/equipment.ts`, `server/missions.ts`, `server/mission-state.ts`, `server/travel.ts`, `server/characters.ts`, `server/character-profile.ts`, `server/actions.ts`, `server/admin-command-seams.ts` (teleport and add-item seams).

Client: `app/play/[characterId]/page.tsx`, `features/play/PlayScreen.tsx`, `features/play/PlayContext.tsx`, `features/play/PlayConsole.tsx`, `features/play/PlayFooterNav.tsx`, `features/play/command-gate.ts`, `features/location-scene/LocationSurface.tsx`, `features/location-scene/LocationSceneHeader.tsx`, `features/npc/NpcInteractionPanel.tsx`, `features/dialogue/DialoguePlayer.tsx`, `features/dialogue/DialogueScene.tsx`, `features/missions/MissionObjectivePanel.tsx`, `features/inventory/InventoryEquipmentPanel.tsx`, `features/inventory/InventoryDetailsStats.tsx`, `features/inventory/InventoryPanel.tsx` (head), `features/travel/LocalMapPanel.tsx`, `features/travel/local-map-layout.ts`, `features/travel/local-map-identifiers.ts`, `features/travel/route-progress.ts`, `components/ui/Drawer.tsx`.

Tests and tooling: `tests/integration/fixtures.ts`, `tests/integration/setup.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/map-geometry.ts`, `tests/unit/locations.test.ts`, `tests/unit/router-matrix.test.ts`, `tests/unit/play-orchestration-boundary.test.ts`, `playwright.config.ts` (canonical allowlist), `scripts/run-focused-e2e.mjs` (phases), `scripts/hold-it-together-backfill.mjs` (head), `package.json`, `.github/workflows/ci.yml` (job structure), plus targeted greps over the remaining test titles listed in §9.

## 2. Existing architecture relevant to Holo Hollow

This section is a concise map of the boundaries the foundation must respect. It states what the code does today; it makes no recommendations.

### 2.1 World Locations and Travel

- **Registry SSOT:** `game/content/locations.ts` — `LOCATIONS` (five entries), `getLocation(id)`, `isActionAvailableAtLocation(locationId, actionId)`, `areLocationsAdjacent(a, b)`, `LOCAL_MAP_LOCATION_IDS`. Every entry is parsed through `LocationDefinitionSchema` at module load and `assertBidirectionalAdjacency` rejects one-way edges.
- **Schema:** `game/schemas/locations.ts` — strict object with `id`, `displayName`, `description`, `region: z.enum(["holo_hollow"])`, `adjacentLocationIds`, `availableActionIds`, `dormantActivities`, and `presentation { mapIconKey (closed enum), layout (closed enum), localMap { axial {q,r}, label }, scene { asset /location-scenes/*.webp|png, width, height, alt, focal? } }`. `LocationIdSchema` is the generic `ContentId` regex (not an enum). Greps show `dormantActivities` and `presentation.layout` have **no consumer** outside the schema and registry.
- **Stable IDs:** `LOCATION_IDS` in `game/config/foundations.ts`; `LocationId` is the union of those five literals.
- **Persisted position:** `characters.current_location_id` (`db/rune-space.ts`, `NOT NULL DEFAULT 'crash_site'`). It is the single source of truth for where a character is. Nothing else persists position.
- **Travel:** `server/play.ts beginTravel` validates with `planTravel` (`game/domain/travel.ts`: unknown destination → `getLocation`, same location, adjacency, already traveling), inserts `active_actions` (`travel`) plus `character_travel_state`, and re-reads the character row after lazy resolution before deciding the origin. `server/travel.ts createTravelResolver` commits arrival by updating `characters.current_location_id` and deleting the travel row, after re-validating origin/destination/adjacency against the registry.
- **Map:** `features/travel/LocalMapPanel.tsx` renders `buildLocalMapGeometry()` (`local-map-layout.ts`) from `LOCAL_MAP_LOCATION_IDS` and each location's `presentation.localMap.axial`; route lines derive from registry adjacency; `MAP_IDENTIFIER_ASSET_BY_KEY` in `local-map-identifiers.ts` is declared `satisfies Record<MapIconKey, string>`, so a new `mapIconKey` enum value without an asset entry is a compile error. Status labels (`Mining`, `Refining`, `Daily cells`) and the selected-hex description are ID-keyed maps/chains inside the panel.

### 2.2 Play state assembly and the transaction boundary

- **Lock + lazy resolution:** `server/action-resolution.ts` — `withResolvedOwnedCharacter(userId, characterId, resolver, command)` locks the owned character row `FOR UPDATE` (ownership-scoped), reconciles the active action exactly once, then runs the command in the same transaction. `withLockedOwnedCharacter` locks without reconciling (used by `claimPowerCells` and `acknowledgeScavengeReveal`). Every state-changing command uses one of these two.
- **Resolver composition:** `server/play.ts createPlayResolver()` composes Mining/Refining/Travel/Welding resolvers; commands pass it so due work (including Travel arrival) resolves before the command body runs. Note that `context.character` is the **pre-reconciliation** snapshot; `beginTravel` and `server/missions.ts currentLocation()` deliberately re-read `characters.current_location_id` after reconciliation.
- **State shape:** `server/play.ts PlayGameplayState` — `location { currentLocationId }`, optional `travelState`, `inventory { slotsUsed, slotsAvailable, massGrams, capacityGrams, stacks[], uniqueItems[] }`, `equipment`, `cargoHold`, `missions`, `powerAnnex` (present only at the Annex), plus per-command error fields. `stateFromTransaction` assembles it; `getPlayGameplayState` is the page-load read; `ensurePlayProvisioning` provisions once per character behind the `character_starter_provisioning` marker.
- **Snapshot read:** `server/play-state.ts loadPlaySnapshot` loads XP, stacks, instances, equipment `FOR UPDATE` and derives slot/mass capacity via `deriveEquipmentLoadout` (`game/domain/equipment.ts`).
- **Command wiring:** `server/actions.ts` (`"use server"`) — each action `safeParse`s a Zod request from `game/schemas/gameplay.ts` (always `characterId: uuid` plus narrow intent), calls `requireCurrentUser`, delegates to a `server/` command, and returns `{ state, <feature result> } | { error }`. Optimistic preconditions are the established retry/staleness guard: `expectedQuantity` (discard, Cargo transfers), `expectedRefinedFerrite`/`expectedSlag` (Cargo contribution).

### 2.3 Inventory ownership

- **Pure planners:** `game/domain/inventory.ts` — `planStackAddition`, `planExactStackAddition` (all-or-nothing, returns `slots|mass` reason), `planExactStackRemoval` (deterministic quantity → createdAt → id order), `planUniqueItemAddition`, `planPossibleAwardAdditions`.
- **Row adapter:** `server/carried-inventory.ts` — `addStackableItem(tx, {characterId, plan, now})`, `applyStackRemovalPlan`, `consumeStackableItem(tx, {characterId, itemId, quantity, now})` (locks matching stacks `FOR UPDATE`, plans, refuses without writing when insufficient), `removeFromSelectedStack` (identity + expected-quantity precondition), `loadOwnedItemInstances` (carried vs Cargo-stored).
- **Item facts:** `game/config/balance.ts` — `getItemDefinition(itemId)` returns `{kind:"stack", stackLimit, massGrams}` or `{kind:"unique", massGrams}`; Ferrite Shale, Refined Ferrite, Slag, and Power Cell are all stack items. `getEffectiveGameBalance()` is the sole balance boundary. Player-facing names/art: `game/content/item-presentation.ts`.
- **Reference implementations of an instantaneous, capacity-checked award:** `server/power-annex.ts claimPowerCells` (location check → uniqueness row → `planExactStackAddition` → `addStackableItem`, all under the character lock) and `server/cargo-hold.ts withdrawCargoStack` (capacity preflight then move).

### 2.4 NPCs, dialogue, and the interaction panel

- **NPC content:** `game/content/npcs.ts` — `NpcDefinition { id, displayName, role, homeLocationId: LocationId, conversationBackgroundId, expressionAssets }`; `NPCS` has Wade (Crash Site) and Tansy (The Jag). `getNpcAtLocation(locationId)` returns the **first** NPC whose `homeLocationId` matches (`.find`). Its only production consumer is `features/npc/NpcInteractionPanel.tsx`; `tests/unit/missions.test.ts` asserts the two current mappings.
- **Dialogue content:** `game/content/dialogue.ts` — `DialogueSequence { id, npcId, beats, action?, actionLabel? }`; each `npc` beat carries its own `speakerNpcId`, `expressionId`, `backgroundId`, and `presentationMode: "local" | "comms"`. Multi-speaker sequences are therefore already expressible at the beat level. Backgrounds come from `game/content/conversation-backgrounds.ts`, which derives exactly two entries (Crash Site exterior, The Jag exterior) from the location registry's scene assets and throws at load if either is missing; `DialogueScene` shows `getLocation(background.locationId).displayName` as the scene plate.
- **Router:** `resolveNpcMissionDialogue(npcId, projections)` is **purely mission-driven**: offers → active → completed story. It returns `undefined` when no mission authors dialogue for that NPC. There is no idle/default/social dialogue tier.
- **Panel:** `NpcInteractionPanel` resolves `npc = getNpcAtLocation(state.location.currentLocationId)`, then `if (!npc || !sequence || !dialogueNpc) return null;`. An NPC with no mission dialogue renders **nothing** — no "Local contact" card, no Talk button. Talk opens `DialoguePlayer` (a `Drawer`); the terminal control runs `acceptMissionAction`/`completeMissionAction` only when the sequence authors an action.

### 2.5 Missions

- Offers, turn-in, and `at_location` requirements carry `locationId: LocationId` (`game/content/missions.ts`), validated at load by `validateMissionDefinitions` through `getLocation`/`getNpc`. Server acceptance/completion (`server/missions.ts`) compares the re-read `characters.current_location_id` with `offer.locationId`/`turnIn.locationId`; projection (`game/domain/missions.ts deriveMissionState`, `deriveGuidance`) does the same with `currentLocationId`. Mission location semantics are explicitly **not** derived from `npc.homeLocationId` (`docs/missions.md` §3, §14).
- `MissionReward` is a closed union: `item` (one unique instance) or `skill_xp`. `docs/missions.md` §8 lists credits as **not currently supported**. §14 lists "remembered conversation steps" as not modelled.

### 2.6 Play composition and route-backed surfaces

- `app/play/[characterId]/page.tsx` → `PlayScreen` reads `useSearchParams().get("surface") === "map"` and passes `surface: "map" | "primary"` to `PlayConsole`; `onMapExit` is `router.replace(pathname)`. This is the established precedent for **navigation state that survives refresh/history without persistence**.
- `PlayConsole` renders `LocalMapPanel` | `JourneyPanel` | `LocationSurface` by surface/transit, then `MissionObjectivePanel`, `NpcInteractionPanel` (stationary only), and the Mining/Refining blocks by location ID. Overlays (`InventoryEquipmentPanel`, `MissionLogPanel`) are independent of the surface and mutually exclusive.
- `LocationSurface` composes `LocationSceneHeader` (prop type `LocationDefinition`), description, `LocationPopulationPanel`, and an ID-keyed activity block (`RefiningConsole` | `MiningActivity` | `CargoHoldPanel` | `PowerAnnexClaimPanel` | fallback "No production activity is available here."), with The Long Scramble special-cased to render no activity block at all.
- `PlayContext` owns overlay open state, the command gate (`acquireCommand`/`releaseCommand`, one in-flight command), `acceptState`, and the boundary auto-refresh scheduler.

### 2.7 Persistence, provisioning, and repair conventions

- `characters` has no economy column. No table references credits, merchants, places, or trades.
- `server/characters.ts createCharacter` inserts the row with an explicit `currentLocationId: LOCATION_IDS.crashSite` (mirroring the column default). `ensurePlayProvisioning` (first play, idempotent marker) inserts skill XP rows, run-state rows, Cargo repair state, and the starter container; legacy characters (marker already present) receive only later additions.
- Migrations are committed Drizzle SQL (`drizzle/0000`…`0016`), applied manually in production; `tests/unit/drizzle-migration-journal.test.ts` enforces journal integrity. `tests/unit/locations.test.ts` asserts the `LOCATION_IDS.crashSite === "crash_site"` lockstep with the migration default — the precedent for keeping a config constant and a column default aligned.
- One-time pre-beta repairs follow `scripts/hold-it-together-backfill.mjs`: dry-run default, saved report, explicit confirmation token, idempotent execution, out of the request path.

### 2.8 Testing architecture

- Unit (Vitest, node): pure domain/content/schema. Integration (Vitest + real PostgreSQL through the disposable-database runner; `tests/integration/fixtures.ts` `cleanupTestCharacter` enumerates every character-scoped table). E2E (Playwright): the canonical allowlist is the regex at `playwright.config.ts:26` (thirteen specs); focused phases are `FOCUSED_PHASES` in `scripts/run-focused-e2e.mjs`. E2E fixtures move characters by writing `characters.current_location_id` directly and seed `inventory_stacks` rows directly (`tests/e2e/cargo-hold.spec.ts`, `tests/e2e/location-population.spec.ts`).

## 3. Local Place ownership

### 3.1 Where the World Location → Local Place distinction should live

**New boundary — content registry.** A Local Place is a new content kind with no existing home. Recommended shape (illustrative, not normative):

```ts
// game/schemas/local-places.ts + game/content/local-places.ts
type LocalPlaceDefinition = {
  id: LocalPlaceId;                 // NEW branded namespace, disjoint from LocationId
  parentLocationId: LocationId;     // exactly one World Location; the only spatial link
  displayName: string;
  description: string;
  presentation: { scene: /* same scene contract as LocationDefinitionSchema */ };
  access: { kind: "open" } | { kind: "locked"; playerReason: string };  // §3.5
  residentNpcId?: NpcId;            // Local-Place-scoped presence, §5
  merchantId?: MerchantId;          // feature ownership, §6 (only when a merchant exists)
};
export function getLocalPlace(id): LocalPlaceDefinition | undefined;
export function getLocalPlacesAt(locationId): readonly LocalPlaceDefinition[]; // [] for the five existing locations
```

Why a separate module rather than a `localPlaces[]` field on `LocationDefinitionSchema`:

- The five existing World Location entries stay byte-for-byte unchanged, honoring "do not force existing simple World Locations to author Local Places" and "do not refactor unrelated existing location/activity branches".
- The **one-level invariant is structural**: `LocalPlaceDefinition` has a `parentLocationId` typed as a World Location ID and no child collection. Recursion is unrepresentable rather than merely unimplemented.
- `LocationDefinitionSchema` is `.strict()`; a separate schema avoids widening the Travel/Map contract with fields Travel never reads.

Nesting inside `locations.ts` would also satisfy the invariants; the difference is small. The non-negotiable property is the next point.

**New boundary — ID namespace.** `LocalPlaceId` must be a **distinct branded namespace** from `LocationId` (a new `LOCAL_PLACE_IDS` map in `game/config/foundations.ts`, exported type `LocalPlaceId`). This is what keeps a Local Place from ever being written to `characters.current_location_id`, `character_travel_state`, `MissionOffer.locationId`, or `BeginTravelRequest.destinationLocationId`. Registry validation at module load should assert: every `parentLocationId` resolves via `getLocation`, IDs are unique, and no Local Place ID collides with a `LOCATION_IDS` value.

### 3.2 What should be content/configuration

- Local Place identity, name, description, scene metadata, parent, static access marker, resident NPC, and feature ownership (merchant) — **content** (`game/content/local-places.ts`).
- Holo Hollow itself — one new `LocationDefinition` entry at axial `(-1, 1)`, adjacent to Crash Site, Emergency Power Annex, and The Long Scramble (three bidirectional edges added to those entries), `availableActionIds: []`, a scene asset, a `mapIconKey`/`layout` enum value, and a map-icon asset — **Small extension** to `game/content/locations.ts`, `game/schemas/locations.ts` (both closed enums), `game/config/foundations.ts LOCATION_IDS`, and `features/travel/local-map-identifiers.ts` (compile-enforced).
- Merchant price tables and starting Credits — balance config (§6).

### 3.3 What should be route/UI state

**Small extension — route-backed surface.** Which Local Place is being viewed is a query parameter on the existing Play route, following the `?surface=map` precedent in `PlayScreen`: for example `?place=<localPlaceId>`. `PlayScreen` derives `surface: "primary" | "map" | "place"` plus the requested place ID; `PlayConsole` composes a `LocalPlaceSurface` for `"place"`. Rules:

- The URL is **never trusted for gameplay**. The composer resolves `getLocalPlace(placeId)` and renders the place only when `place.parentLocationId === state.location.currentLocationId` and `!state.travelState`; otherwise it renders the ordinary Location/Journey surface (and may `router.replace(pathname)` to clean the URL, as `onMapExit` does today).
- Refresh and browser history work because the URL carries the place, exactly as Map does. No `localStorage`, no context-only state.
- Entering a place is `router.push(`${pathname}?place=…`)`; "Back to Holo Hollow" is `router.replace(pathname)`. No server call, no action row, no cursor — which is what makes it non-Travel by construction.

Transient trade quantity/tab state lives in the trade component (§7), like `InventoryPanel`'s selection state.

### 3.4 What should be authoritative persisted server state

**Nothing new for position.** `characters.current_location_id` continues to say the character is at Holo Hollow (**Reuse unchanged**). **Avoid for now:** a `current_local_place_id` column, a "last visited place" row, place-visit history, or any table keyed by Local Place.

The only new persisted state in the whole foundation is the Credits balance (§6, §10).

### 3.5 Visible-but-locked access without a requirements DSL

**New boundary — one pure domain function.** `game/domain/local-places.ts deriveLocalPlaceAccess(place, observation) → { status: "available" } | { status: "locked"; reason: string }`. For the foundation the observation is empty and the function simply reads the authored `access` marker (HH B&B authors `{ kind: "locked", playerReason: "…locals and regular workers only…" }`).

This mirrors the existing narrow predicate pattern `deriveCargoRepairAccess` (`server/cargo-repair-access.ts`), which is consumed by both presentation (`stateFromTransaction` → `cargoHold.repair.repairAvailable`) and the command guards in `server/cargo-hold.ts`. Same rule here: the Local Places list on the Location surface and every server command that targets a Local Place must call the **same** function.

When the follow-up Wade apprentice Mission is implemented, the union gains exactly one variant (for example `{ kind: "mission_completed", missionId, lockedReason }`) evaluated from mission projections that `PlayGameplayState.missions` already carries. That is "the smallest condition mechanism proven necessary when a real Mission/world-state unlock is implemented". **Avoid for now:** a generic predicate/requirements language, `unlockedBy[]` arrays, or evaluating arbitrary state keys.

### 3.6 Server verification of interaction legality without persisted place state

**New boundary — one shared server guard.** A small helper in `server/` (for example `server/local-places.ts resolveLocalPlaceInteraction(transaction, context, localPlaceId, now)`) used by every command that acts inside a Local Place (the trade command in §6 is the only one in this slice). It must:

1. run inside `withResolvedOwnedCharacter` with `createPlayResolver()` so a due Travel arrival/departure resolves first (the pattern used by Cargo, discard, equipment, and mission commands);
2. refuse when `context.action` is present after reconciliation (any active action, including Travel) — the "stationary" rule;
3. **re-read** `characters.current_location_id` after reconciliation (as `beginTravel` and `server/missions.ts currentLocation()` do) rather than trusting `context.character.currentLocationId`;
4. resolve `getLocalPlace(localPlaceId)` and refuse unless `parentLocationId` equals the re-read location;
5. call `deriveLocalPlaceAccess` and refuse when locked;
6. hand back the place so the feature command can check feature ownership (`place.merchantId === request.merchantId`).

`claimPowerCells` demonstrates the alternative (`withLockedOwnedCharacter` + refuse on any action row without resolving). Either is server-authoritative; the resolved pattern is recommended because the closest analog (Cargo transfers: instantaneous inventory movement gated on stationary + location) uses it, and it avoids refusing a player whose arrival is due but unreconciled.

### 3.7 Narrowest implementation summary

| Concern | Classification | Where |
| --- | --- | --- |
| Persisted world position | Reuse unchanged | `characters.current_location_id`, Travel resolver |
| Holo Hollow hex, adjacency, assets | Small extension | `LOCATION_IDS`, `locations.ts`, schema enums, `local-map-identifiers.ts` |
| Local Place registry + ID namespace | New boundary | `game/config/foundations.ts LOCAL_PLACE_IDS`, `game/schemas/local-places.ts`, `game/content/local-places.ts` |
| Derived access | New boundary (one function) | `game/domain/local-places.ts` |
| Route-backed place surface | Small extension | `PlayScreen`, `PlayConsole` |
| Server interaction guard | New boundary (one helper) | `server/local-places.ts` (name illustrative) |
| Persisted place position, recursion, requirements DSL, pseudo-location entries in `LOCATIONS` | Avoid for now | — |

## 4. Location composition

### 4.1 How current composition should evolve

Today's `LocationSurface` is one ID-keyed chain. The foundation adds a second real composition shape: an exterior that lists contained places, and a place interior with its own scene, resident NPC, feature panel, and return control.

Recommended evolution (all **Small extension** unless noted):

1. **`LocationSurface`** gains one generic block: `const places = getLocalPlacesAt(locationId)`; when non-empty, render a `LocalPlacesPanel` (new, `features/location-scene/` or `features/local-places/`) listing each place with name, short description, and either an Enter control or a locked treatment with the derived reason. The existing fallback `Feedback` ("No production activity is available here.") should be suppressed when `places.length > 0`, generically. No `LOCATION_IDS.holoHollow` conditional is needed; the five existing locations return `[]` and render exactly as today. The Long Scramble special case stays as is.
2. **`PlayConsole`** adds the `"place"` surface branch that renders `LocalPlaceSurface` instead of `LocationSurface`, keeps `MissionObjectivePanel`, and passes the place's resident NPC to the NPC panel (§5). The Mining/Refining blocks remain keyed to their locations and never render for a place (their conditions already require `surface === "primary"` and the specific location).
3. **`LocalPlaceSurface`** (new component, small): scene header, place name/description, "Back to {parent displayName}" control, resident `NpcInteractionPanel`, and the feature panel (trade) when the place authors one. `LocationPopulationPanel` is **not** rendered inside a place — population is World-Location-owned (`docs/architecture.md`), and the population read is keyed by `current_location_id`; rendering it inside a shop would imply presence semantics the game does not have.
4. **`LocationSceneHeader`** currently takes `location: LocationDefinition`. Either widen its props to `{ sceneId: string; displayName: string; scene: SceneMetadata }` (its body only reads `presentation.scene`, `displayName`, and `id` for `data-location-scene`) or give the place surface its own thin header. Widening is smaller; keep the `data-location-scene` attribute semantics because `tests/e2e/location-population.spec.ts` selects on it.

### 4.2 The smallest genuinely reusable abstraction

The reusable abstraction justified by this second composition shape is exactly: **"a surface that composes a scene, description, resident NPC, and optional feature panel from a registry entry."** That is what `LocalPlaceSurface` is. It is generic over Local Places (any later settlement/station/business authors entries in the same registry), not over World Locations. **Avoid for now:** a unified "SpatialNode" abstraction covering both World Locations and Local Places, a generic `ActivityRegistry` mapping location IDs to panels, or refactoring `LocationSurface`'s existing chain into a data-driven activity table. The design document explicitly rules out broad refactoring "solely to make Local Places look universal", and the current chain has four distinct feature-owned consumers whose gating already lives in their own features.

### 4.3 Components/surfaces that remain unchanged

**Reuse unchanged:** `LocalMapPanel` (the sixth hex renders from registry data; only the ID-keyed status-label map and selected-hex description chain may optionally gain a Holo Hollow line), `JourneyPanel`, `LocationPopulationPanel`, `CharacterProfilePanel`, `MissionObjectivePanel`, `MissionLogPanel`, `InventoryEquipmentPanel`, `Drawer`, `DialoguePlayer`, `DialogueScene`, `PlayContext`, `PlayFooterNav`, all Mining/Refining/Cargo/Annex feature panels.

### 4.4 Map geometry check for `(-1, 1)`

`buildLocalMapGeometry` throws on duplicate axial coordinates; `(-1, 1)` is unused. In flat-top axial terms, the neighbors of `(-1, 1)` include `(0, 1)` Crash Site, `(0, 0)` Annex, and `(-1, 2)` The Long Scramble — all three approved adjacencies are geometric neighbors, so the derived route lines are the same uniform length as existing routes. `(1, 0)` Processing Yard and `(-2, 3)` The Jag are not neighbors, matching the design. Column `q = -1` already exists (The Long Scramble), so the map's bounding box does not widen; the 390 px mobile constraint is unaffected by geometry (the panel already scrolls). **Low-risk reuse.**

## 5. NPC presence and interaction

### 5.1 Presence scoped to a Local Place

**Small extension — content.** Add an optional `localPlaceId?: LocalPlaceId` to `NpcDefinition`. `homeLocationId` stays and must equal the place's `parentLocationId` (validated at load). Then:

- `getNpcAtLocation(locationId)` filters out NPCs that have a `localPlaceId`, so the Holo Hollow **exterior resolves no NPC** (Bix is in the shop, Renn is in the Assistance Center). Wade/Tansy behavior is unchanged (`tests/unit/missions.test.ts` continues to pass).
- New `getNpcAtLocalPlace(localPlaceId)` returns the resident. `LocalPlaceDefinition.residentNpcId` and the NPC's `localPlaceId` should be validated as mutually consistent; keeping both is a convenience, keeping only the NPC-side field is equally valid. Pick one authoritative direction and derive the other.

The single-NPC `.find` shape is preserved: each spatial context (World Location exterior or one Local Place) still resolves at most one resident interaction. That is precisely the approved constraint ("no speculative simultaneous multi-NPC interaction architecture").

### 5.2 Where scoping belongs

- **Content:** the `localPlaceId`/`residentNpcId` mapping (above).
- **UI composition (Small extension):** `NpcInteractionPanel` should accept the resolved `npc` as a prop (or an explicit spatial context) instead of calling `getNpcAtLocation(state.location.currentLocationId)` itself. `PlayConsole` supplies `getNpcAtLocation(currentLocationId)` on the primary surface and `getNpcAtLocalPlace(placeId)` on the place surface. Nothing else in the panel depends on location.
- **Server validation:** not needed for Talk (dialogue is presentation; mission accept/complete already validate `offer.locationId`/`turnIn.locationId` against the World Location). Trade is validated by the guard in §3.6. **Avoid for now:** persisting NPC presence, NPC schedules, or projecting NPCs into `PlayGameplayState`.

### 5.3 Confirmed incompatibility: no idle dialogue tier

`NpcInteractionPanel` renders nothing unless `resolveNpcMissionDialogue` returns a sequence, and the router only returns mission-authored sequences. In the foundation slice **no mission references Bix or Renn** (the Wade apprentice Mission is deferred). As the code stands, Renn's social conversation and Bix's Talk action would not render at all.

**Small extension (content + composition), not a new dialogue system:**

- `NpcDefinition.idleDialogueId?: DialogueId` — the NPC's ordinary conversation when no mission owns their dialogue. Validate at load that the sequence exists and its `npcId` matches (reuse the `assertDialogueNpc` shape in `game/domain/missions.ts`).
- In the panel: `const resolved = resolveNpcMissionDialogue(npc.id, state.missions) ?? idleDialogueFor(npc)`, where the idle resolution has no `missionId` and no `action`. `runDialogueAction` already refuses when `missionId` is absent, so the terminal control is simply Next/Finish. Mission routing always wins, so when the later Wade Mission authors Bix dialogue it supersedes idle automatically — no ordering change in the router.
- The existing mission router (`resolveNpcMissionDialogue`) stays untouched (**Reuse unchanged**). Adding the fallback inside the router would force a `missionId` into a non-mission resolution; composing it in the panel keeps the router's contract.

### 5.4 Reused unchanged

`DialoguePlayer`, `DialogueScene` (per-beat speaker and background), `resolveDialogueSpeaker`, the `expressionAssets` contract, `resolveNpcMissionDialogue`, `deriveMissionGuidanceTargets`, and the mission accept/complete commands. Mara's later cameo inside Bix's shop is expressible today as beats with `speakerNpcId: mara` inside a Bix-owned sequence — no multi-NPC panel is needed, which matches the design document.

### 5.5 Small extension: conversation backgrounds

`CONVERSATION_BACKGROUNDS` derives from World Location scenes and `DialogueScene` plates the World Location name. Bix's and Renn's beats need interior backgrounds (shop, Assistance Center). Extend `ConversationBackgroundDefinition` so an entry can derive its asset from a Local Place scene and carry the label to plate (the place name). The module's load-time guard should be generalized from "Crash Site and The Jag scenes must exist" to "every referenced scene must exist". `tools/qc-studio/adapters/runespace/dialogue-adapter.ts` consumes `CONVERSATION_BACKGROUNDS`/`NPCS`; new entries should flow through without adapter changes — **needs verification during implementation**.

## 6. Credits and economy

### 6.1 Authoritative persistence boundary

**New boundary — one column.** `characters.credits integer NOT NULL DEFAULT 10 CHECK (credits >= 0)`.

Why a column on `characters` rather than a `character_credits` table:

- Every state-changing command already locks the character row `FOR UPDATE` (`lockCharacterRow`). Credits mutate under that same lock with no additional locking protocol and no risk of lock-order divergence.
- Credits are character-scoped by design; there is no account-level aggregate.
- `stateFromTransaction` already selects the character row (or receives it), so exposing `credits` in `PlayGameplayState` is one field.

The `DEFAULT 10` covers both new rows and the existing pre-beta cohort in one committed migration (no backfill script, no runtime compatibility branch — consistent with AGENTS.md pre-beta policy). The approved starting value should also live in `game/config/balance.ts` (for example `economy.startingCredits: z.literal(10)`) and be written explicitly by `createCharacter` (as `currentLocationId` is today), with a unit test asserting the balance constant equals the migration default — the `tests/unit/locations.test.ts` lockstep precedent.

**Avoid for now:** a ledger/transaction-history table, account-level wallets, multiple currencies, decimal amounts, or an audit trail for player trades (the operator audit log is for operator mutations only).

### 6.2 Domain and server ownership

- **Domain (New boundary, pure):** `game/domain/trade.ts` — `planMerchantTrade({ side, unitPrice, quantity, credits, ownedQuantity? }) → { ok: true; totalCredits } | { ok: false; reason }` with integer guards (`Number.isSafeInteger`, quantity ≥ 1, unit price ≥ 0). Safe to run on both client (presentation) and server (authority).
- **Server (New boundary, one command):** `server/merchant-trade.ts executeMerchantTrade(userId, characterId, request)` inside `withResolvedOwnedCharacter` + `createPlayResolver()`, using the §3.6 guard, then Buy or Sell as in §6.5.
- **Wiring (Small extension):** `server/actions.ts tradeWithMerchantAction`, `game/schemas/gameplay.ts MerchantTradeRequestSchema`.
- **State (Small extension):** `PlayGameplayState.credits: number` from `stateFromTransaction`.
- **Presentation (Small extension):** Credits row in the Inventory drawer and character information; prominent balance inside the trade panel. **No** top-bar element (`PlayScreen`'s `TopBar` stays as is), per the approved decision.

### 6.3 Merchant inventory and prices

- **Prices — balance config.** They are approved playtest balance values with an explicit expectation of later tuning; `game/config/balance.ts` is "the sole effective-balance boundary" and already hosts every numeric gameplay constant as Zod literals. Recommended: `economy.merchants.bixWeller.{buys: [{itemId, unitPrice}], sells: [{itemId, unitPrice}]}` (Ferrite Shale 2 / Refined Ferrite 10 / Slag 1 / Power Cell 3 on the buy-from-player side; Power Cell 8 on the sell side).
- **Merchant identity — content.** `game/content/merchants.ts` (or a `merchant` block on the Local Place entry): `{ id, localPlaceId, npcId }` plus accessors `getMerchant(id)`, `merchantPrice(merchantId, side, itemId)` reading the balance table. Load-time validation: every priced item resolves via `getItemDefinition` and is `kind: "stack"`, prices are non-negative safe integers, the merchant's place and NPC exist. Which of balance/content owns the table is a small choice; the invariant is **one home** referenced by both the trade panel and the trade command.
- **Stock — Avoid for now.** The design document specifies "Not initially stocked" for items Bix does not sell and gives no stock quantities. Buy-from-player is unlimited buyback; sell-to-player Power Cells are unlimited. No stock table, restock timer, or per-character purchase cap is needed in the first slice.

### 6.4 Integration with existing inventory adapters (no reimplementation)

- **Sell (player → merchant):** `consumeStackableItem(tx, { characterId, itemId, quantity, now })` — it locks matching stacks, plans the exact removal, and refuses without writing on insufficiency. Then `UPDATE characters SET credits = credits + total WHERE id = $1`.
- **Buy (merchant → player):** `loadPlaySnapshot(tx, characterId)` (locks stacks/instances/equipment and derives slots/mass) → `planExactStackAddition(stacks, itemId, quantity, stackLimit, slotsAvailable, massAvailableGrams, massGrams)` → refuse with `slots | mass` → `addStackableItem(tx, { characterId, plan, now })` → `UPDATE characters SET credits = credits - total WHERE id = $1 AND credits >= total RETURNING credits`; treat zero rows as a refusal (belt-and-braces under the lock; the `CHECK` is the last line).

This is exactly the `claimPowerCells` and `withdrawCargoStack` shape. **Reuse unchanged:** all planners and the row adapter. The UI never touches stacks.

### 6.5 Transactional and locking invariants

1. One `db.transaction`, character row locked `FOR UPDATE` by ownership before anything is read → concurrent trades for the same character serialize.
2. Credits change and item movement commit together or not at all; any thrown error rolls back both (the `mission-framework.test.ts` "rolls back consumption when the reward application fails" pattern proves this class).
3. Server computes the unit price from the balance table and the total as `unitPrice × quantity`; the client's numbers are only an optimistic precondition.
4. Sell quantity ≤ carried quantity is enforced by the removal plan, never by a client value; Buy capacity is enforced by the addition plan on the freshly locked snapshot.
5. `CHECK (credits >= 0)` and the conditional `UPDATE … AND credits >= total` guarantee no negative balance even under a logic bug.
6. Optimistic preconditions for staleness/retry: `expectedUnitPrice` (refuse `price_changed` if the balance table changed since render) and `expectedCredits` (refuse `credits_changed` if the balance moved). A retried request after a successful trade therefore refuses instead of buying/selling twice, without an idempotency-key table. This is the repository's existing pattern (`expectedQuantity`, `expectedRefinedFerrite`); the client command gate (`acquireCommand`) remains the first line against double submission.

### 6.6 Validation at command execution time (in order)

ownership/lock → lazy reconciliation → no active action / no travel row → re-read `current_location_id` equals the place's parent → place access available → merchant belongs to that place → item is on the requested side of that merchant → quantity is a positive safe integer → authoritative unit price and total → `expectedUnitPrice`/`expectedCredits` match → Buy: `credits ≥ total` and capacity plan ok; Sell: consumption plan ok → apply → return `{ state, trade }`.

## 7. Trade UX contract

### 7.1 Client-side presentation calculations (safe)

Using content/balance already importable in client components (`LocalMapPanel` imports `getEffectiveGameBalance()` today) and `PlayGameplayState`:

- unit price per row (from the merchant price table);
- owned quantity per item (`state.inventory.stacks` summed by `itemId`);
- live total = `unitPrice × quantity` (via `planMerchantTrade`, the same pure function the server uses);
- affordability = `total ≤ state.credits` (Buy);
- Max: Sell = owned quantity; Buy = `min(floor(credits / unitPrice), capacityFitQuantity)` where `capacityFitQuantity` can be computed client-side with `planExactStackAddition` over `state.inventory.stacks` plus `slotsAvailable` and `capacityGrams − massGrams` (a presentation-only reuse of the identical pure planner, so Max never disagrees with the server's rule except when state is stale, in which case the server refuses and the panel refreshes);
- quantity starts at 1; minus/plus clamp to `[1, max]`.

### 7.2 Authoritative state that must come from the server

`credits`, `inventory` (stacks/slots/mass) — both in `PlayGameplayState` — and the outcome of every commit. Prices are authored content, so they may be read client-side for display, but the server recomputes them on commit.

### 7.3 Checks repeated atomically at commit

Everything in §6.6. The response carries the refreshed `state`, so credits and inventory update immediately and the player remains on the place surface.

### 7.4 Minimum contract

Request: `{ characterId, merchantId, side: "buy" | "sell", itemId, quantity, expectedUnitPrice, expectedCredits }`.

Response: `{ state, trade: { status: "completed"; side; itemId; quantity; unitPrice; totalCredits; creditsAfter } | { status: "refused"; reason; message } }` with reasons such as `in_transit | active_action | not_at_place | place_locked | unknown_merchant | unsupported_item | invalid_quantity | price_changed | credits_changed | insufficient_credits | insufficient_items | capacity_slots | capacity_mass`.

### 7.5 Surface and confirmation

Render the trade panel **inline on the place surface** (like `CargoHoldPanel` at Crash Site), not as a `Drawer`: `PlayConsole` allows one overlay at a time and the dialogue player is itself a `Drawer`, so an overlay-based trade surface would fight the Talk flow and the Inventory drawer. Buy/Sell as two tabs; each row shows art (`ItemVisual`), name, unit price, owned quantity; a quantity stepper with Max; one Buy/Sell commit button; `Feedback`/`TransientStatus` for the result. **No confirmation modal** — nothing in the current architecture makes it unavoidable, and the approved design forbids a redundant one. Talk remains the existing `NpcInteractionPanel` button; Trade is a separate control on the place surface.

## 8. Mission compatibility

### 8.1 Do current mechanisms support Local Places?

Yes, without change, because Local Places never alter `characters.current_location_id`:

- **Discovery/guidance:** `deriveGuidance` marks an offer available when `offer.locationId === currentLocationId`; inside Bix's shop the character is still at Holo Hollow, so an offer authored at Holo Hollow/Bix is available there. **Reuse unchanged.**
- **Acceptance/turn-in:** `acceptMission`/`completeMissionForDefinition` compare the re-read World Location with `offer.locationId`/`turnIn.locationId` and require no active action. A turn-in with Bix authored at `holo_hollow` works while the player stands in the shop. **Reuse unchanged.**
- **Dialogue routing:** `resolveNpcMissionDialogue` is keyed by NPC ID only. **Reuse unchanged.**
- **Validation:** `validateMissionDefinitions` resolves `offer.locationId` via `getLocation`; Holo Hollow is a real World Location, so authored missions validate. **Reuse unchanged.**

### 8.2 Do location requirements assume only World Locations in a way that breaks anything?

They assume World Locations, and that is **correct**: the persisted position is a World Location, and the design says a Local Place is "not a second persisted character coordinate". No requirement in the foundation needs "is inside place X". No concrete incompatibility exists for the foundation. A mission cannot, today, require *being inside* a Local Place; that is consistent with the design, not a gap.

### 8.3 Narrow future concerns for the deferred Wade apprentice Mission (not foundation scope)

Recorded so the foundation does not accidentally foreclose them:

1. **Credits reward.** `MissionReward` has no `credits` kind (`docs/missions.md` §8). The column design in §6.1 makes a later `{ kind: "credits", amount }` reward one `UPDATE … SET credits = credits + amount` under the same lock plus a validation branch. Nothing in the foundation should model this yet.
2. **"Visit and interact with Bix even if the player already carries three Cells."** That is a remembered conversation step, which §14 of `docs/missions.md` lists as not modelled. It will need a deliberate, narrow requirement kind (for example an NPC-interaction step recorded by the generic accept path or a new command) — decided when that Mission is authored, not now.
3. **Guidance presentation for NPCs inside Local Places.** `MissionGuidanceTargets.availableNpcIds`/`npcIds` are consumed by the NPC panel. When the target NPC is inside a Local Place and the player is on the exterior, the exterior has no NPC panel to highlight; the natural narrow extension is for `LocalPlacesPanel` to also consume the same derived targets (mapping `residentNpcId` → place row). Foundation work should keep `residentNpcId` on the Local Place entry so this stays a consumer-side change.
4. **Mara's authored cameo** is expressible today via per-beat `speakerNpcId`; requires only Mara's NPC entry and expression art at that time.

No redesign or generalization of the mission framework is warranted by the foundation.

## 9. Testing strategy

### 9.1 Unit (pure content/domain)

- `game/content/local-places.ts` registry validation: unique IDs, parent resolves, no ID collision with `LOCATION_IDS`, resident NPC/place consistency, one-level by type (a compile-time check is enough; a runtime assertion that no entry has a `parentLocationId` that is itself a Local Place ID documents the invariant).
- `deriveLocalPlaceAccess`: open vs locked with reason.
- `planMerchantTrade`: totals, affordability, Max derivation, integer/overflow guards, quantity bounds.
- Merchant/price validation: every priced item is a stack item with a definition; approved values present (2/10/1/3 buy, 8 sell); starting Credits lockstep with the migration default.
- `getNpcAtLocation(holo_hollow)` is `undefined`; `getNpcAtLocalPlace` resolves Bix/Renn; Wade/Tansy unchanged.
- Dialogue router: extend `tests/unit/router-matrix.test.ts` — idle fallback used when no mission dialogue exists; mission dialogue supersedes idle.
- Location registry: update `tests/unit/locations.test.ts` (six locations; `(-1, 1)` adjacency to Crash Site/Annex/Long Scramble only; no edge to The Jag or Processing Yard) and `tests/unit/local-map-layout.test.ts` (eight undirected routes / sixteen segments; no duplicate coordinate). `tests/unit/location-scene.test.ts` requires the Holo Hollow scene entry to be valid.
- Play-surface derivation: a pure helper for `?place=` resolution (valid place at current location → place surface; foreign/unknown/in-transit → primary) so the URL rule has DB-free proof.

### 9.2 Integration (PostgreSQL) — the highest-value tests

Model on `tests/integration/inventory-discard.test.ts`, `power-annex.test.ts`, and `mission-framework.test.ts`:

- **No item duplication/loss:** Sell N removes exactly N across stacks in the deterministic order and Buy N adds exactly N respecting stack limits; a forced failure after the stack write rolls back the stack change (assert row counts/quantities before and after).
- **No Credits duplication/loss:** Buy debits exactly `unitPrice × N`; Sell credits exactly that; a forced failure after the credits write rolls back credits; conservation check: `credits + Σ(unitPrice × owned)` is invariant across a Sell followed by a Buy of the same item at equal prices (or assert both deltas explicitly).
- **Concurrency:** launch several Buy requests for the same character in parallel with credits sufficient for one; exactly one completes and the rest refuse (`insufficient_credits` or `credits_changed`); final credits and stacks are consistent. Repeat for parallel Sells exceeding owned quantity.
- **Retry:** replaying the identical successful request refuses with `credits_changed` and changes nothing.
- **Server-side price validation:** a request with a manipulated `expectedUnitPrice` refuses with `price_changed` and changes nothing; the server never uses the client price.
- **Inventory capacity failures:** Buy into a full container refuses `capacity_slots` with no credit change; Buy that exceeds mass refuses `capacity_mass`; both leave rows untouched (mirror `power-annex.test.ts` "refuses full-reward slot or mass fit without recording a claim").
- **Local Place interaction legality:** trade refused at Crash Site (`not_at_place`), during Travel (`in_transit`), with an active action, at a locked place (`place_locked`), for a merchant not at the requested place, for an item not on that side; ownership refusal for a foreign character (mirror `inventory-discard.test.ts` "another user cannot discard").
- **Navigation is non-Travel/non-persisted:** after a trade, `characters.current_location_id` is still `holo_hollow`, and no `active_actions`/`character_travel_state` rows were created (assert directly).
- **Provisioning/migration:** a newly created character has `credits = 10`; the `CHECK` rejects a direct negative update.

### 9.3 E2E (browser is part of the contract)

One new spec (for example `tests/e2e/holo-hollow.spec.ts`), seeded like `cargo-hold.spec.ts` (set `current_location_id` to Holo Hollow, insert stacks):

- Holo Hollow Location lists three places; HH B&B is visible, locked, and shows the reason; the Long Scramble-style "no activity" fallback is absent.
- Enter Bix's shop: URL gains the place parameter; scene/name/Back render; **refresh keeps the shop view**; the DB still says `holo_hollow` and no travel state exists (assert via `db` as `travel.spec.ts` does).
- Talk to Bix opens idle dialogue with no action control; Talk to Renn at the Assistance Center works the same.
- Trade: Sell 2 Ferrite Shale (10 → 14 Credits, stacks update, still in shop), Buy 1 Power Cell (14 → 6), Max clamps, insufficient credits disables/refuses, one commit control, no confirmation modal.
- Back returns to Holo Hollow; Map shows the sixth hex; Crash Site → Holo Hollow is walkable (extend `travel.spec.ts` status-label assertions minimally or keep in the new spec).

Add the spec to the canonical allowlist regex in `playwright.config.ts` and a phase in `scripts/run-focused-e2e.mjs`, otherwise it never runs in CI.

### 9.4 Existing canonical tests likely to protect regressions

`tests/integration/carried-stack-adapter.test.ts` (consumption order and refusal-without-write), `inventory-discard.test.ts` (concurrency, rollback, ownership), `power-annex.test.ts` (capacity refusals, claim serialization), `cargo-hold.test.ts` (transfer capacity refusals), `travel.test.ts` (adjacency/unknown destination — will need the new edges), `mission-framework.test.ts` (rollback on reward failure, exactly-once), `tests/unit/router-matrix.test.ts`, `tests/unit/missions.test.ts` (NPC mapping), `tests/unit/admin-destinations.test.ts` (asserts "at least the five" — tolerant of a sixth), `tests/unit/play-orchestration-boundary.test.ts` (ownership structure), E2E `travel.spec.ts`, `location-population.spec.ts`, `walk-it-off.spec.ts` (asserts `[data-npc-interaction]` is absent during Travel; the same absence must hold on the Holo Hollow exterior, which has no resident NPC).

## 10. Migration and persistence impact

| Item | Classification | Detail |
| --- | --- | --- |
| `characters.credits` | **New persisted state (required)** | One committed Drizzle migration (`drizzle/0017_*`): `ALTER TABLE characters ADD COLUMN credits integer NOT NULL DEFAULT 10; ADD CONSTRAINT characters_credits_non_negative CHECK (credits >= 0)`. Update `db/rune-space.ts`. `cleanupTestCharacter` needs no change (column, not table). |
| Local Place position | Authored content + URL state only | No table, no column. |
| Merchant stock, trade ledger, price history | Avoid for now | Not required by the approved slice. |
| Local Place registry, NPC scoping, idle dialogue, merchant definitions, prices, starting Credits | Content/config | `game/content/*`, `game/config/foundations.ts`, `game/config/balance.ts`. |
| Holo Hollow location entry + scene + map icon assets | Content + committed assets | `public/location-scenes/holo-hollow.*`, `public/map-icons/holo-hollow.*`; Local Place scenes for the shop, Assistance Center, and locked B&B exterior. |
| Backfill/repair | **None required** | The column default seeds every existing row. If the owner wants the pre-beta cohort to start at a different balance, that is a one-time reviewed SQL/maintenance step per `docs/deployment-database.md`, never runtime logic. |
| Documentation (implementation issues, not this report) | Required updates | `docs/gameplay-foundations.md` (six-location world, adjacency), `docs/travel-map-design.md` (five → six hexes, assets table), `docs/location-scenes.md` (assets), `docs/architecture.md` (Place surface ownership), a new economy/Local Place contract section (likely a new doc or a section of `docs/gameplay-foundations.md`), and a public Update per `docs/public-updates.md`. |

## 11. Implementation sequencing

Four issues on real seams. Issue 3 has no art dependency and is independent of 1–2; 1 → 2 → 4 is the dependency chain. Issues 3 and 4 are the pair most reasonably merged if the owner prefers three PRs; keeping them separate isolates the only schema change for review.

### Issue 1 — Add the Holo Hollow World Location

- **Purpose:** put Holo Hollow on the map at `(-1, 1)` with approved adjacency so Travel, Map, population, and admin teleport work there, as an initially activity-free location (like The Long Scramble but with its own scene).
- **Boundary:** `LOCATION_IDS`, `game/content/locations.ts`, `game/schemas/locations.ts` enums, `local-map-identifiers.ts`, committed scene + map-icon assets, optional directed travel-flavor lines, docs (`gameplay-foundations.md`, `travel-map-design.md`, `location-scenes.md`), tests (`locations.test.ts`, `local-map-layout.test.ts`, `location-scene.test.ts`, `travel.test.ts` adjacency cases, a minimal Map/Travel E2E assertion).
- **Dependencies:** approved Holo Hollow exterior scene and map identifier assets.
- **Acceptance areas:** six-location registry validates; bidirectional edges only to Crash Site/Annex/Long Scramble; walk Crash Site ↔ Holo Hollow; no Mining/Refining/Cargo/Annex controls render there; 390 px map has no horizontal overflow; existing canonical suites pass.
- **Out of scope:** Local Places, NPCs, Credits, trade, any Holo Hollow-specific UI beyond the generic Location surface.

### Issue 2 — Local Place foundation, resident NPCs, and Talk

- **Purpose:** the generic one-level Local Place registry, route-backed place navigation, visible-but-locked access, Local-Place-scoped NPC presence with idle dialogue, and the three Holo Hollow places (shop with Bix — Talk only; Assistance Center with Renn; HH B&B locked).
- **Boundary:** `LOCAL_PLACE_IDS`, `game/schemas/local-places.ts`, `game/content/local-places.ts`, `game/domain/local-places.ts` (`deriveLocalPlaceAccess`), `NpcDefinition.localPlaceId`/`idleDialogueId` + `getNpcAtLocalPlace`, conversation-background extension, `PlayScreen`/`PlayConsole` `place` surface, `LocalPlacesPanel`, `LocalPlaceSurface`, `LocationSceneHeader` prop widening, `NpcInteractionPanel` `npc` prop, Bix/Renn NPC + dialogue content, docs (`architecture.md` Play surfaces; Local Place contract), tests (§9.1 unit set, E2E navigation/refresh/locked/Talk), canonical allowlist + focused phase.
- **Dependencies:** Issue 1; Bix and Renn portraits/expressions and authored idle dialogue; shop, Assistance Center, and locked-B&B art.
- **Acceptance areas:** existing five locations render unchanged; Holo Hollow exterior shows no NPC panel and lists three places; entering is immediate, URL-backed, refresh-stable, creates no action/travel rows and never changes `current_location_id`; B&B visible and refused with the authored reason; Bix and Renn Talk render idle dialogue with no mission action; Wade/Tansy dialogue and all mission E2E unchanged.
- **Out of scope:** Credits, trade, merchant content, any mission, Mara's interior/dialogue, population inside places, guidance for place-resident NPCs.

### Issue 3 — Character-scoped Credits persistence and presentation

- **Purpose:** the single schema change and the authoritative balance in play state, visible in Inventory/character information (no HUD).
- **Boundary:** migration `0017_*`, `db/rune-space.ts`, `balance.economy.startingCredits`, `createCharacter` explicit value, `PlayGameplayState.credits`, Inventory drawer row, optional admin inspector row, lockstep unit test, integration test (new character = 10; CHECK rejects negative), doc section.
- **Dependencies:** none (can run in parallel with Issues 1–2).
- **Acceptance areas:** migration applies cleanly on the disposable database and is journal-valid; every existing and new character shows 10 Credits; nothing can spend or earn Credits yet; no top-bar element.
- **Out of scope:** trade, merchant prices, mission credit rewards, ledger/history.

### Issue 4 — Bix Weller merchant Buy/Sell

- **Purpose:** the reusable merchant trade command and UI at Holo Hollow Souvenirs + Mining Supplies with the approved price table.
- **Boundary:** `balance.economy.merchants`, `game/content/merchants.ts`, `game/domain/trade.ts`, `server/local-places.ts` guard, `server/merchant-trade.ts`, `MerchantTradeRequestSchema`, `tradeWithMerchantAction`, `features/trade/TradePanel.tsx` composed into `LocalPlaceSurface` when the place authors a merchant, docs (economy contract, public Update), tests (§9.2 integration set, §9.3 trade E2E).
- **Dependencies:** Issues 2 and 3.
- **Acceptance areas:** Sell Shale/Refined Ferrite/Slag/Power Cell and Buy Power Cell at approved prices; quantity from 1 with −/+/Max; live total; one commit; no confirmation modal; player stays in the shop; Credits and inventory update immediately; all §6.5 invariants proven at the integration layer; refusals for location/transit/locked/capacity/insufficient/stale price.
- **Out of scope:** merchant stock, contracts, other merchants, mission integration, Credits HUD, unique-item trading.

## 12. Risk register

| # | Risk | Evidence (current boundary) | Why it matters | Classification | What confirms or eliminates it |
| --- | --- | --- | --- | --- | --- |
| R1 | NPCs without mission dialogue render nothing | `features/npc/NpcInteractionPanel.tsx` line 65 `if (!npc \|\| !sequence \|\| !dialogueNpc) return null;`; `resolveNpcMissionDialogue` returns `undefined` outside mission tiers | Renn (social-only) and Bix (Talk without a mission) would have no interaction in the foundation | **Confirmed incompatibility** | Resolved by the idle-dialogue fallback in §5.3; router-matrix unit test plus E2E Talk assertions confirm |
| R2 | Single-NPC-per-location resolution | `getNpcAtLocation` uses `.find`; only consumer is the panel; `tests/unit/missions.test.ts` asserts the two mappings | Three Holo Hollow NPCs at one World Location would collapse to the first match | **Likely extension point** | `localPlaceId` filtering (§5.1); unit test that the Holo Hollow exterior resolves no NPC and each place resolves its resident |
| R3 | Stale location after lazy reconciliation | `withResolvedOwnedCharacter` hands the pre-reconciliation `context.character`; `beginTravel` and `server/missions.ts currentLocation()` re-read; `claimPowerCells` avoids reconciliation instead | A trade command using `context.character.currentLocationId` could accept a trade after a due departure resolved, or refuse one after a due arrival | **Needs verification during implementation** | Integration test: begin Travel from Holo Hollow, advance the cursor past arrival, then trade → refused `not_at_place`; and the reverse (due arrival at Holo Hollow, trade succeeds) |
| R4 | Concurrent/retried trades duplicating Credits or items | Character row `FOR UPDATE`; `consumeStackableItem` locks stacks; no idempotency-key mechanism exists anywhere; precedent is `expected*` preconditions | Double debit/credit or over-consumption under parallel requests or client retries | **Needs verification during implementation** | §9.2 concurrency and retry tests; `expectedCredits` precondition; conditional `UPDATE … AND credits >= total` |
| R5 | Closed presentation enums and compile-enforced asset map | `game/schemas/locations.ts` `mapIconKey`/`layout` enums; `MAP_IDENTIFIER_ASSET_BY_KEY satisfies Record<MapIconKey,string>` | Missing entries fail typecheck, not at runtime | **Low-risk reuse** | `pnpm typecheck` |
| R6 | Map geometry at `(-1, 1)` | `buildLocalMapGeometry` duplicate-coordinate guard; neighbors computed in §4.4 | Overlapping hexes or non-uniform routes | **Low-risk reuse** | Updated `local-map-layout.test.ts`; 390 px overflow assertion already in `location-population.spec.ts` |
| R7 | New E2E spec silently excluded from CI | `playwright.config.ts:26` allowlist regex; `FOCUSED_PHASES` | Trade/navigation coverage never runs in the canonical shards | **Needs verification during implementation** | Allowlist and phase updated; canonical timing artifact lists the spec |
| R8 | Existing tests hard-code five locations | `tests/unit/locations.test.ts` "exactly the five"; `local-map-layout.test.ts` 5 routes/10 segments; `travel-map-design.md` "Five locations" | Issue 1 breaks these until updated | **Low-risk reuse** (expected churn) | Update in Issue 1 |
| R9 | Starting-Credits default also seeds the pre-beta cohort | `characters` column default pattern (`current_location_id DEFAULT 'crash_site'`); AGENTS.md pre-beta policy | Existing dev/test characters silently receive 10 Credits | **Needs owner acknowledgment** (see §13) | Owner confirms; otherwise a one-time reviewed SQL step |
| R10 | Conversation backgrounds derive from World Location scenes | `conversation-backgrounds.ts` load guard and `locationId`; `DialogueScene` plates `getLocation(locationId).displayName` | Interior beats for Bix/Renn need a background source and a correct plate label | **Likely extension point** | Extend the definition to reference a Local Place scene; unit test that every background's scene resolves |
| R11 | `LocationSceneHeader` prop coupling and the 4:1 scene convention | Prop type `LocationDefinition`; `docs/location-scenes.md` header viewport assumes 1920×480 panoramic art | Interior art delivered at a different aspect would crop badly in the shared viewport | **Needs verification during implementation** (asset property genuinely required: panoramic 4:1 for interior scenes if the shared header is reused) | Asset pass delivers 4:1 interiors, or the place surface uses its own viewport |
| R12 | Place URL parameter interaction with Map | `onMapExit` = `router.replace(pathname)`; Map link is `${pathname}?surface=map` | Opening Map from inside a shop drops the place; Back from Map lands on the exterior | **Low-risk reuse** (acceptable UX; document it) | E2E assertion of the chosen behavior |
| R13 | QC Studio adapter coupling | `tools/qc-studio/adapters/runespace/dialogue-adapter.ts` consumes `NPCS`/`CONVERSATION_BACKGROUNDS` | New NPC/background IDs must flow through authoring/export without adapter edits | **Needs verification during implementation** | `pnpm test:studio` and QC Studio E2E after Issue 2 |
| R14 | Mission guidance for place-resident NPCs (future) | `deriveGuidance` availability keyed by World Location; consumer is the NPC panel only | Not a foundation defect; the later Wade Mission needs the place list to consume guidance | **Likely extension point** (deferred) | Addressed with that Mission; keep `residentNpcId` on the place entry now |
| R15 | Unused registry fields | `dormantActivities` and `presentation.layout` have no consumers | Temptation to repurpose them for Local Places | **Avoid** (do not repurpose or remove in these issues; unrelated cleanup) | — |

## 13. Questions still requiring product/art decisions

Only decisions that cannot be resolved from `docs/holo-hollow.md` or the current implementation:

1. **Pre-beta Credits seeding.** The recommended migration default gives every existing development/test character 10 Credits. Is that acceptable, or should the existing cohort be seeded differently by a one-time reviewed step? (The design specifies the value for new characters only.)
2. **Mara Kells in the foundation.** The in-scope list names Mara, but HH B&B is locked with no interior, so no foundation surface would display her. Should Issue 2 ship a Mara NPC record (which requires at least one expression asset to be renderable) or defer her content entirely to the B&B unlock/Wade Mission work? The audit assumes deferral of her content while the B&B entry itself ships locked.

## 14. Recommended next step

1. Owner reviews this report and decides the two questions in §13.
2. Owner files the four issues in §11 (or merges Issues 3 and 4). Issue 3 can start immediately with no art dependency; Issue 1 starts when the Holo Hollow exterior scene and map identifier are approved.
3. When accepted, the implementing issues carry the normative parts of §3–§7 into the canonical docs. Until then this document stays non-normative under `docs/research/`.
