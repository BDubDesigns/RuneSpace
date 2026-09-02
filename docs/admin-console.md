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

All operator commands act on exactly **one** selected character. There is **no
population-wide reset**: RESET ALL MISSIONS clears only the selected
character's mission rows. Operator commands are reached behind a character
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
| ADD ITEM | `added_stackable_item` / `added_unique_item` | Canonical item ids, capacity-preflighted, unique charge initialized canonically. v1 carries only. |
| Reset from here (per mission) | `reset_mission_chain` | Console control shown on each authored-mission row; clears the selected mission and its transitive prerequisite descendants (`missionChainResetScope`). |
| RESET ALL MISSIONS | `reset_all_missions` | Clears only the selected character's mission rows. |
| SET TOTAL XP | `set_skill_xp` | Absolute value; only skills with an approved progression curve (`skillLevelThresholds`). |

Every command returns the refreshed authoritative `PlayGameplayState`, which the
inspector swaps in place.

## Audit history

`operatorAuditLogs` (`db/rune-space.ts`, migration `0015`) is the smallest
relational append-only record of successful operator mutations. One row is
written **atomically inside the same transaction** as the mutation it records, so
a success and its audit commit or roll back together. Rows are immutable; there
is no update or delete path, and the operator console only ever reads them.

An audit row is written **only for a genuine operator mutation** (correction D6):

- No audit for STOP-after-natural-reconcile-end, reset-with-no-rows,
  reset-all-none, set-XP-to-same-value, teleport-to-current-location-without-interruption, or any refused/stale/invalid command.
- Normal lazy gameplay reconciliation is never audited.

Operation kinds are enumerated in `server/admin-audit.ts`
(`OPERATOR_OPERATIONS`) and include a `targetIdentity` and a structured
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
  resolves canonically).
- PostgreSQL integration: `tests/integration/admin-operator.test.ts` exercises
  reconcile/interrupt/audit/command-layer rejection, Mining-tool FORCE UNEQUIP
  invalidation, Cargo stack removal reloading post-mutation state, authored-only
  mission reset, and fail-closed unsupported-action interruption, against a real
  database.
- Browser: the admin console has an E2E spec whose deterministic admin-session
  bootstrap is gated on a proof (see the PR notes); the rest of #113 is not
  gated on that fixture.