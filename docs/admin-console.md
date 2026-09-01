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
- Every admin read and mutation calls `requireAdmin` server-side. The browser is
  never trusted for authorization.
- There is intentionally **no admin link in ordinary player bottom navigation**;
  direct `/admin` access is acceptable for v1.

To enable an operator locally, put their Better Auth user id (a stable UUID) in
`RUNESPACE_ADMIN_USER_IDS`. Never commit real production IDs to `.env.example`
or docs.

## Scope and single-character discipline

All operator commands act on exactly **one** selected character. There is **no
population-wide reset**: RESET ALL MISSIONS clears only the selected
character's mission rows. Operator commands are reached behind a character
search (`/admin/characters`) and resolve to a per-character inspector
(`/admin/characters/{characterId}`).

## Command layer and the shared lock

`server/admin-commands.ts` implements each operator command over the **shared
character lock + lazy-reconcile boundary** (`withResolvedCharacter` in
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
| RESET FROM THIS MISSION | `reset_mission_chain` | Clears the selected mission and its transitive prerequisite descendants (`missionChainResetScope`). |
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
`details` (never secrets, tokens, or session data).

## Enabling the console

1. Set `RUNESPACE_ADMIN_USER_IDS` to the comma-separated Better Auth user IDs of
   the operators.
2. Navigate directly to `/admin` while signed in as one of those users.
3. Find a character, open its inspector, and use the confirmed operator controls.

## Tests

- Unit: `tests/unit/admin-auth.test.ts`, `tests/unit/admin-schema.test.ts`,
  `tests/unit/mission-reset-scope.test.ts`.
- PostgreSQL integration: `tests/integration/admin-operator.test.ts` exercises
  reconcile/interrupt/audit/command-layer rejection against a real database.
- Browser: the admin console has an E2E spec whose deterministic admin-session
  bootstrap is gated on a proof (see the PR notes); the rest of #113 is not
  gated on that fixture.