# Admin / Operator Console (Issue #113)

A small, authenticated operator console for character inspection, state repair,
and test-state controls. It is **admin-only**, **one-character-at-a-time**, and
every successful operator mutation writes an immutable audit history.

This document is the authoritative contract for authorization, command
semantics, and audit. It complements `docs/architecture.md` (boundaries) and
`docs/authentication.md` (session security).

## Authorization

Admin power is granted **solely** by the server-only allowlist env var
`RUNESPACE_ADMIN_USER_IDS` (comma-separated stable Better Auth user IDs),
parsed by `server/env.ts` and enforced by `server/admin-auth.ts`. There is no
database role, no browser-authored role, and no hidden UI affordance that grants
admin access.

- Absent or empty allowlist ⇒ **no admins**, everything fails closed.
- `requireAdmin(headers)` authenticates the request via Better Auth, then checks
  the allowlist. An ordinary authenticated user gets a `403` `AdminError`.
- **Page-level 401-vs-403 behavior** (`authorizeAdminPage`):
  - no valid Better Auth session ⇒ unauthenticated ⇒ the admin route redirects
    to `/sign-in`;
  - authenticated but not on the allowlist ⇒ `forbidden` ⇒ the admin route
    renders a **safe 403 Forbidden page** (never the console, and never a
    sign-in redirect that silently discards the already-authenticated session).
- Every admin read and mutation calls `requireAdmin` server-side. The browser is
  never trusted for authorization; admin identity always comes from the
  server-side Better Auth session, never from client-supplied input.
- There is intentionally **no admin link in ordinary player bottom navigation**;
  direct `/admin` access is acceptable for v1.
- The one permitted admin-only link on a player surface is **Edit in Admin** on
  the player's own Character surface (#333; see "Character shortcut" below). It
  is a convenience, never an authorization.

### Character shortcut (#333)

The Character surface (`features/characters/CharacterPanel.tsx`, shared by the
phone modal and the docked desktop panel) shows a compact **Edit in Admin** link
beside the character's identity block **if and only if** the viewer is on the
allowlist. The Play page (`app/play/[characterId]/page.tsx`) decides this
server-side with `isAdminUserId` from `server/admin-auth.ts` — the same
check `requireAdmin` uses, not a second copy of the rule — and passes down only
the resulting inspector href (`adminCharacterInspectorHref`, the single home of
the `/admin/characters/{characterId}` route), built from the active
character's id. Nothing about the allowlist, a role, or a browser-supplied
value reaches the client, an ordinary player is given no href and no link, and
because the href is recomputed for each Play route, Switch Character always
retargets it. Hiding the link authorizes nothing: `/admin/characters/{id}`
and every command behind it still call `requireAdmin` themselves, so an
ordinary player who types the URL gets the safe 403 page.

To enable an operator locally, put their Better Auth user id in
`RUNESPACE_ADMIN_USER_IDS`. Never commit real production IDs to `.env.example`
or docs.

### How to obtain a user id safely

Better Auth user ids are **opaque stable text** — they are *not* guaranteed to be
UUIDs, so do not assume a 36-char `xxxxxxxx-xxxx-…` shape or a UUID library
format. The allowlist accepts whatever opaque string Better Auth uses for the
`user.id` column.

The safe, secrets-free way to obtain your own user id is to read the **public
`id` column** of the `user` table for your authenticated account — it is an
identifier, not a credential. Do *not* print or share the session token, the
`session.token` column, password hashes, or any `*_secret`/`*_token` env value.
Examples (run against the environment's database):

```sql
-- You are the operator; resolve your own stable user id by email address.
-- Quote the table name: "user" is a reserved word in most SQL dialects.
SELECT id FROM "user" WHERE email = 'you@example.com';
```

```bash
# Or use Better Auth tooling/your own dashboard that shows the signed-in
# account's id — again, the id is not a secret.
```

Then put that exact id into `RUNESPACE_ADMIN_USER_IDS`. Because the id is opaque
text, treat it as an opaque string throughout; never generate it with a UUID
helper on the assumption it must match a UUID format.

## Scope and single-character discipline

All character operator commands act on exactly **one** selected character.
There is **no population-wide reset**: RESET ALL MISSIONS clears only the
selected character's mission rows. The two issue #223 access controls are the
deliberate exceptions: Early Access targets the selected character's whole
owning player account, and PUBLIC GAMEPLAY targets the global RuneSpace access
state (see "Account and global access controls" below). Operator commands are reached behind a character
search (`/admin/characters`) and resolve to a per-character inspector
(`/admin/characters/{characterId}`).

## Command layer and the shared lock

`server/admin-commands.ts` is the **production admin command surface**: every
exported command is safe-by-construction through `requireAdmin(headers)` and then
delegates to the matching internal command body in `server/admin-command-seams.ts`
(an INTERNAL module, not a production entrypoint). The raw `*AsAdmin` seams and
the `runAdminCharacterCommandAs` runner live only in that internal module / the
internal runner, so a server caller cannot reach a skip-authorization command
through the production surface. Each command runs over the **shared character
lock + lazy-reconcile boundary** (`withResolvedCharacter` in
`server/action-resolution.ts`) — the exact `FOR UPDATE` row lock and
`reconcileActiveAction` used by player commands. The player path scopes the same
lock by the player's account id inside one transaction; the admin path enters it
*only after* `requireAdmin` and without an ownership scope. There is one shared
lock primitive, never two implementations.

Because the admin command runs through the same boundary, due activity work
(an in-flight Mining loop, an arriving Travel) is reconciled **exactly once**,
exactly as a player command would, before the operator forces idle. Operator
interruption never re-resolves: it uses `forceIdleResolvedAction`
(`server/play-interrupt.ts`), which only cleans the remaining POST-reconciliation
action using Play's own activity persistence:

- Mining → delete active action + `characterMiningState.lastStopReason = "manually_stopped"`
- Refining → delete active action + `characterRefiningState.lastStopReason = "manually_stopped"`
- Welding → delete active action only (no `lastStopReason` field)
- Travel → delete active action + `characterTravelState` only (preserves `characterScavengeReveals`)
- idle → no-op
- **unsupported/unknown action id → throws (fails closed)**: #113 only knows how
  to safely clean Mining / Refining / Welding / Travel. A future activity could
  add activity-specific auxiliary persistence, so an unknown active action is
  **never** deleted blindly — the command refuses rather than orphan state.

FORCE UNEQUIP of the Mining tool while an active Mining action is live reuses
the **authoritative Mining-loadout invalidation** (`invalidateMiningActionForChangedTool`,
shared with the player `changeEquipment` path): the active action is cleared and
`characterMiningState.lastStopReason` is set to `compatible_mining_tool_missing`
instead of committing an active Mining action against an invalid loadout.

Normal lazy gameplay reconciliation performed while loading the inspector or
entering a command is **not** an operator mutation and is never logged.

## Operator commands

| Control | Command | Notes |
| --- | --- | --- |
| STOP CURRENT ACTION | `stop_current_action` | Force-idle after reconcile; no-op when idle. |
| TELEPORT / SET LOCATION | `teleport_character` | Destination validated against the canonical location registry (`getLocation`), early and under the lock. Relocates `characters.currentLocationId` after reconciling any Travel arrival; never fakes Travel/Scavenge/Rune/adjacency/history. Same-location + not-interrupted is a no-op. |
| Carried/Cargo REMOVE 1 / REMOVE STACK | `removed_stack_quantity` | Exact identity (`stackId`) + verified `expectedQuantity`; never substitutes another stack. |
| FORCE UNEQUIP | `force_unequipped_item` | Capacity-validated (`planEquipmentChange`); an equipped unique must be unequipped before deletion. |
| Delete unique item | `removed_unique_item` | Exact instance deletion (carried or Cargo); equipped uniques are refused until force-unequipped. |
| ADD ITEM | `added_stackable_item` / `added_unique_item` | Any canonical inventory item (see "Item catalog"). Canonical item ids, capacity-preflighted, unique charge initialized canonically. v1 carries only. |
| Reset from here (per mission) | `reset_mission_chain` | Console control shown on each authored-mission row; clears the selected mission and its transitive prerequisite descendants (`missionChainResetScope`). |
| RESET ALL MISSIONS | `reset_all_missions` | Clears only the selected character's mission rows. |
| SET TOTAL XP | `set_skill_xp` | Absolute value; only skills with an approved progression curve (`skillLevelThresholds`). The picker lists exactly the skills the Character surface presents (`xpSettableSkills`, built on the shared `presentedSkills` rule: curve + canonical presentation), so a new approved skill appears without an admin edit. |

Every command returns the refreshed authoritative `PlayGameplayState`, which the
inspector swaps in place.

### Item catalog (#333)

ADD ITEM offers **every** item with an authoritative inventory definition —
stackables and uniques, including advanced materials, components, gems, tools
and containers. The list is derived, never maintained for the console: ids and
kind (stack or unique) come from `inventoryItemDefinitions()`
(`game/config/balance.ts`, the same definitions `getItemDefinition` resolves),
and display names from item presentation, in `adminGrantableItems()`
(`features/admin/admin-format.ts`). A newly authored item therefore appears
with no admin edit, and nothing in `features/admin/` restates an item id,
name, mass, stack limit or charge default. The picker is ordered by display
name and has a name filter.

Grant semantics are unchanged and still enforced only by the server command:
a stackable takes a positive whole quantity (omitted means one) and respects the
item's stack limit, carried slots and carry mass; a unique item is granted one
instance, with no quantity (an explicit quantity is refused) and with charge
initialized canonically (`getItemMaximumCharge`, the same rule Fabrication and
Mission rewards use). An unknown item, an invalid quantity, or insufficient
capacity is refused under the character lock with no partial grant and no audit
row; the console reports the refusal. There is deliberately no capacity bypass,
no grant-all, and no mission-completion shortcut.

## Inspector organization (#333)

The per-character inspector shows one section at a time, as an ARIA tab list
(roving tab stop, arrow / Home / End navigation, touch-sized targets). The strip
scrolls inside itself, so every tab is reachable at phone width with no
page-level horizontal overflow. Each tab holds the state **and** the controls
that change it:

| Tab | Contents |
| --- | --- |
| Overview | Identity and owner, location, current action and Travel state, STOP, TELEPORT. |
| Inventory | Carried inventory with ADD / REMOVE ITEM, Equipment with FORCE UNEQUIP, Cargo hold with its remove controls, and every unique instance. |
| Missions | Authored-mission records and the RESET FROM HERE / RESET ALL controls. |
| Skills | Skill XP, level and progress, and SET TOTAL XP. |
| Account | Account access and Early Access controls (issue #223) with the account's access history. |
| Moderation | The selected account's moderation panel (issue #248). |
| History | The character's operator audit history. |

The identity, **Refresh state**, and the latest mutation result stay above the
tab content (the tab strip and the result remain in view while a long section
scrolls). The authoritative snapshot lives above the tabs, so a tab switch
never discards refreshed state; it also mutates nothing — an unsubmitted form
or armed confirmation is simply dropped, never submitted. The Moderation tab
loads no case or sensitive data until its own **Show moderation history**
control is used, exactly as before, so adding a tab broadens neither moderation
access nor the privileged-access log.

## Account and global access controls (Issue #223)

The gameplay-access contract itself — the rule, its seams, persistence, and
the rollout preflight — is `docs/gameplay-access.md`. The console adds two
controls; there is no new admin page, account search, or date editor.

- **Account access panel** on the existing selected-character inspector. The
  inspector already resolves the character's owning player account; the panel
  shows Player account ID, email verification status, public gameplay
  Open/Closed, Early Access Granted/Not granted, granted at, and granted by
  (the granting operator's user id), plus that account's access history.
  `Grant Early Access` (confirmation **Grant Early Access to this account?** —
  "All characters on this RuneSpace account will be able to enter gameplay
  before public Soft Alpha opens.") and `Revoke Early Access` (equivalent
  confirmation) apply to the whole account, never only the inspected
  character. While public gameplay is open the grant is kept and marked
  currently irrelevant.
- **PUBLIC GAMEPLAY panel** on the Operator Console home, separate from the
  inspector: the launch target (`October 27, 2026 · 9:00 AM Pacific`), current
  state, and the shared countdown (**LAUNCH IMMINENT!** at/after the target
  while closed). `Open Public Gameplay` (confirmation **Open RuneSpace to
  everyone?**) and the emergency `Close Public Gameplay` (confirmation **Close
  public gameplay?**) flip the one explicit switch. The target is never edited.

| Control | Command | Target | Notes |
| --- | --- | --- | --- |
| Grant Early Access | `grant_early_access` | player account | Sets both paired fields; already granted ⇒ no-op, no audit. |
| Revoke Early Access | `revoke_early_access` | player account | Clears both paired fields; not granted ⇒ no-op, no audit. |
| Open Public Gameplay | `open_public_gameplay` | system | Already open ⇒ no-op, no audit. |
| Close Public Gameplay | `close_public_gameplay` | system | Already closed ⇒ no-op, no audit. |

These commands follow the same production stance: `server/admin-commands.ts`
calls `requireAdmin(headers)` and then the internal seam in
`server/admin-command-seams.ts`, which locks the account row (or the access
singleton) `FOR UPDATE` and commits the state change and its one audit row in
one transaction. Reads for the panels live in `server/admin-access-state.ts`.
Operator status never grants gameplay: an operator's own account plays early
only with an explicit Early Access grant.

## Moderation (Issue #248)

The console also hosts moderation: the queue at `/admin/moderation`, each case
at `/admin/moderation/{caseId}`, the privileged access log at
`/admin/moderation/access-log`, and a Moderation panel on the inspector (the
account's cases, and "Open a case" with a stated reason). The contract —
cases, sanctions, appeals, the legitimate-access boundary for retained chat,
and the privileged-access audit that records every view of sensitive safety
data — is `docs/moderation.md`. Moderation commands follow the same stance as
every other operator command: `server/moderation-commands.ts` calls
`requireAdmin(headers)` and then the internal seams in
`server/moderation-seams.ts`.

## Audit history

`operatorAuditLogs` (`db/rune-space.ts`, migration `0015`; target
generalization in `0026`) is the smallest relational append-only record of
successful operator mutations. Each row states its target explicitly:
`target_kind` is `character` (only `character_id` set), `player_account` (only
`player_account_id` set), or `system` (neither), enforced by a database CHECK
with RESTRICT foreign keys. Every row written before issue #223 migrated as a
`character` row with its meaning unchanged, and the per-character history the
inspector shows is still exactly that character's rows. One row is
written **atomically inside the same transaction** as the mutation it records, so
a success and its audit commit or roll back together. Rows are immutable; there
is no update or delete path, and the operator console only ever reads them.

Issue #248 adds seven moderation operations. They target the case subject's
`player_account`, and each carries the case in `moderation_case_id`; they are
shown in that case's history, not in the inspector's account history, because
viewing moderation data is itself audited (`docs/moderation.md`). Operator
*views* of sensitive safety data are recorded separately, in
`privileged_access_logs`, so this table keeps meaning "successful mutations".

An audit row is written **only for a genuine operator mutation** (correction D6):

- No audit for STOP-after-natural-reconcile-end, reset-with-no-rows,
  reset-all-none, set-XP-to-same-value, teleport-to-current-location-without-interruption, or any refused/stale/invalid command.
- No audit for granting Early Access that is already granted, revoking Early
  Access that is not granted, opening public gameplay that is open, or closing
  public gameplay that is closed.
- Normal lazy gameplay reconciliation is never audited.

Operation kinds are enumerated in `server/admin-audit.ts`
(`OPERATOR_OPERATION_TARGET_KINDS`, which also fixes each operation's one
target kind) and include a `targetIdentity` and a structured
`details` (never secrets, tokens, or session data). The console renders each
row's `details` as a concise human-readable summary (via
`formatAuditSummary` in `features/admin/admin-format.ts`, which resolves
canonical ids to display names and never invents data the row does not carry);
the operation id, operator id, exact target identity, authoritative ISO
timestamp, and raw structured details remain available as secondary forensic
information.

## Enabling the console

1. Set `RUNESPACE_ADMIN_USER_IDS` to the comma-separated Better Auth user IDs of
   the operators, obtained safely (see "How to obtain a user id safely"). The
   ids are opaque text, not necessarily UUIDs.
2. Navigate directly to `/admin` while signed in as one of those users.
3. Find a character, open its inspector, and use the confirmed operator controls.

Every destructive operator control is **confirm-before-commit** and its
confirmation names the target character plus the concrete affected entity/value
(e.g. the exact stack + quantity, the unique instance id, the mission chain, or
the skill XP change), so the operator confirms the actual consequence.

The inspector surfaces the full #113 read model for a selected character: display
name + stable character id, current location/action, Travel origin/destination/
start/arrival timing, carried stack ids/quantities and unique instance ids with
mutable state and equipped slot, equipment slots + capacity-relevant data, Cargo
repair/stacks/unique instances, authored-mission records (title/id/
prerequisite/status/acceptedAt/completedAt), skills XP with derived level/
progress, and the recent operator history.

## Tests

- Unit: `tests/unit/admin-auth.test.ts`, `tests/unit/admin-schema.test.ts`,
  `tests/unit/mission-reset-scope.test.ts`,
  `tests/unit/admin-surface.test.ts` (production surface exposes no bypass seam),
  `tests/unit/admin-destinations.test.ts` (every offered teleport destination
  resolves canonically), `tests/unit/admin-offered-items.test.ts` (the ADD ITEM
  catalog is derived from the canonical item definitions and restates no id), `tests/unit/operator-audit-target.test.ts` (issue
  #223 target shapes).
- PostgreSQL integration: `tests/integration/admin-operator.test.ts` exercises
  reconcile/interrupt/audit/command-layer rejection, Mining-tool FORCE UNEQUIP
  invalidation, Cargo stack removal reloading post-mutation state, authored-only
  mission reset, and fail-closed unsupported-action interruption, against a real
  database. It also grants every canonical item (#333) — each stackable and each
  unique — and proves capacity, quantity and unique-quantity refusals leave no
  partial grant or audit row; `tests/integration/admin-session-proof.test.ts`
  proves a non-admin is refused ADD ITEM. Issue #223 access controls, their atomic audit, no-op silence, and
  non-admin refusal are in `tests/integration/gameplay-access.test.ts`; the
  audit migration replay is `tests/integration/gameplay-access-migration.test.ts`.
- Browser: the admin console has an E2E spec whose deterministic admin-session
  bootstrap is gated on a proof (see the PR notes); the rest of #113 is not
  gated on that fixture. It also covers the inspector tabs (keyboard, phone and
  desktop width, no overflow), full-catalog grants, and the Edit in Admin link
  for an operator and its absence for an ordinary player. The issue #223 controls are exercised end to end in
  `tests/e2e/gameplay-access.spec.ts`.