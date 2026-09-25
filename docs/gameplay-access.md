# Gameplay Access, Early Access, and Public Launch Controls (Issue #223)

This is the authoritative contract for who may enter RuneSpace gameplay before
and during the October 27 Soft Alpha. It builds on the verified account
boundary from issue #221 (`docs/authentication.md`) and the Operator Console
(`docs/admin-console.md`).

## The rule

```text
canEnterGameplay = emailVerified && (publicGameplayOpen || earlyAccessGranted)
```

`decideGameplayAccess` in `game/domain/gameplay-access.ts` is the only
implementation. It has no clock input and no operator input:

- reaching the launch target never grants access;
- membership in the admin allowlist (`RUNESPACE_ADMIN_USER_IDS`) never grants
  access — an operator's own account plays early only with an explicit Early
  Access grant, like any other account;
- the browser never decides access. Hiding a Play button is presentation only.

`server/gameplay-access.ts` is the only place that loads the rule's inputs:
one query per request joins the account row, `user.email_verified` read from
the database (never the session payload), and the global access singleton.
Nothing caches entitlement, so revoking Early Access or closing public
gameplay takes effect on the very next authoritative request. A missing
singleton row fails closed.

## Persistence

- **Early Access (current state)** lives on `player_accounts` as the pair
  `early_access_granted_at` + `early_access_granted_by_admin_user_id`. Both
  null = no Early Access; both set = active. The CHECK
  `player_accounts_early_access_paired_check` rejects any partial state. There
  is no boolean, expiry, invite code, or per-character row. Grant sets both;
  revoke clears both; history lives only in the operator audit.
- **Global access state** is the singleton `runespace_access_state`
  (`id = 1`, CHECK-enforced): the explicit, reversible `public_gameplay_open`
  switch, the fixed presentation target `soft_alpha_launch_target_at`,
  `updated_at`, and `updated_by_admin_user_id` (null only for the
  migration-seeded row). It is not a settings platform, env var, redeploy
  toggle, or lifecycle enum. No application code writes the target.
- Migration `0026_gameplay_access_launch_control` seeds the singleton
  **Closed** with the target **2026-10-27T16:00:00Z** (9:00 AM
  America/Los_Angeles). Applying it can never open public gameplay.

## Enforcement seams

The gate is enforced at the two lowest shared server seams, not in pages or
components:

1. **Owned-character lock boundaries** (`server/action-resolution.ts`).
   `withResolvedOwnedCharacter` (lock + lazy reconcile) and
   `withLockedOwnedCharacter` (lock only) both resolve the player account
   through `resolvePlayableAccountId` → `requireGameplayAccess`, inside the
   command's transaction and **before** the character row is locked. A refused
   account never locks its row and never reconciles due activity work. Every
   player gameplay command and the initial/refresh Play state load enter here.
2. **Unlocked gameplay reads** use `requirePlayableOwnedCharacter`
   (`server/gameplay-access.ts`): the Play page and the location-population and
   character-profile route handlers. The old ungated `requireOwnedCharacter`
   no longer exists.

The Operator Console's admin boundary (`withResolvedCharacter`) never passes
through either seam, so operators can inspect and repair gated characters,
while the allowlist still grants no gameplay.

A refusal is `GameplayAccessError` — an `OwnershipError` with status 403 and
the stable code `GAMEPLAY_ACCESS_REQUIRED` — so any existing ownership handler
refuses it safely.

## Entrypoint inventory

`tests/unit/gameplay-entrypoints.test.ts` keeps this inventory exhaustive: it
fails when a server action, page, or route is added without a classification,
and checks that each gameplay entrypoint uses its seam and recovery.

**Player server actions (`server/actions.ts`, 37 exports).** The 34 gameplay
actions and their seams:

| Group | Actions | Seam |
| --- | --- | --- |
| Play state | `refreshPlayAction` | lock + reconcile (`getPlayGameplayState`) |
| Missions | `acceptMissionAction`, `completeMissionAction`, `acknowledgeMissionConversationAction` | lock + reconcile |
| Mining | `startMiningAction`, `stopMiningAction`, `loadPowerCellAction` | lock + reconcile |
| Refining | `startRefiningAction`, `stopRefiningAction` | lock + reconcile |
| Repair Welding | `startWeldingAction`, `stopWeldingAction`, `contributeRepairMaterialsAction` | lock + reconcile |
| Practice | `startPracticeWeldingAction`, `stopPracticeWeldingAction`, `finishCurrentPracticeWeldAction`, `setPracticeSlagPreferenceAction`, `claimCleanPassAction` | lock + reconcile |
| Work Orders | `acceptWorkOrderAction`, `startWorkOrderWeldingAction`, `stopWorkOrderWeldingAction`, `refreshWorkOrderBoardAction` | lock + reconcile |
| Cargo Hold | `depositCargoStackAction`, `withdrawCargoStackAction`, `depositCargoUniqueItemAction`, `withdrawCargoUniqueItemAction` | lock + reconcile |
| Inventory / Equipment | `discardInventoryStackAction`, `equipEquipmentAction`, `unequipEquipmentAction` | lock + reconcile |
| Travel / Scavenge | `beginTravelAction`, `beginTransportTravelAction`, `claimScavengeAction` | lock + reconcile |
| Instant interactions | `acknowledgeScavengeRevealAction`, `claimPowerCellsAction`, `tradeWithMerchantAction` | lock only (deliberately no reconcile) |

The three remaining actions are account/character management and stay
available while public gameplay is closed:

- `createCharacterAction` — character reservation (verified email still
  required through `requireVerifiedUser`);
- `changeCharacterPortraitAction` — pre-game character presentation;
- `acknowledgeNewsAction` — account-level Update news.

**Pages and route handlers.**

| Entrypoint | Classification |
| --- | --- |
| `/play/[characterId]` | gameplay — `requirePlayableOwnedCharacter`, then the lock + reconcile Play load; any refusal redirects to `/characters` |
| `GET /api/location-population`, `GET /api/character-profile` | gameplay reads — `requirePlayableOwnedCharacter`; refusal is 403 `GAMEPLAY_ACCESS_REQUIRED` |
| `/characters`, `/characters/new` | account/character management (reservation and presentation) |
| `/`, `/updates/*`, `/wiki/*`, `/api/build-info`, `/api/diagnostics` | public; the landing reads only the public launch state |
| `/sign-in`, `/register`, `/api/auth/*` | account (Better Auth) |
| `/admin/*` | operator (`requireAdmin`); never player gameplay |
| `/design-system`, `/qc-studio`, `/api/e2e/turnstile-siteverify` | dev/test only, gated off in production |

There are no middleware, SSE, socket, polling-timer, or minigame entrypoints.

## Stale already-open pages

No live session kick exists or is needed. An already-loaded Play page stays
visible until its next authoritative request, which the server refuses:

- every gameplay server action calls `redirectOnGameplayRefusal` first in its
  error handler (directly or through `runPlayAction` / `runEquipmentAction`),
  turning the refusal into `redirect("/characters")`. That covers the Play
  console's own boundary `refreshPlayAction` as well as player commands;
- the two gameplay read panels navigate to `/characters` when a route answers
  `GAMEPLAY_ACCESS_REQUIRED`;
- a navigation or reload of `/play/...` redirects on the server.

Next.js commits a server-action redirect into router state even when a
client `catch` swallows the rejected promise, so recovery does not depend on
every client call site. Client diagnostics ignore that redirect signal.

## Character reservation

`createCharacterAction` still requires a verified email and is not gameplay.
After a successful reservation the server decides the destination from the
same authoritative access load: an account that can play right now enters
`/play/{id}`; a verified ordinary account waiting for Soft Alpha returns to
`/characters`.

## Player-facing presentation

One pure derivation, `presentSoftAlphaLaunch` in
`game/domain/soft-alpha-launch.ts`, drives every countdown from the persisted
target, the persisted switch, and a reference time: `SOFT ALPHA OPENS IN`
with `34D · 07H · 12M · 09S` before the target (remaining whole seconds
rounded up, so the final fractional second still counts down), then
**LAUNCH IMMINENT!** at and after the exact target while public gameplay is
closed, and nothing once it is open. `features/launch/SoftAlphaCountdown.tsx`
renders it on the landing, the waiting Characters experience, and the Operator
Console. It is server-rendered from server time, ticks on a browser clock
anchored to that server time, and never writes, refreshes, or grants anything.

- **Characters, verified, closed, no Early Access** — `SOFT ALPHA · OCTOBER
  27`, **Claim your crew** (no characters) or **Your crew is reserved**, the
  locked copy, the countdown, `READY FOR ALPHA` on each reserved character (no
  fake disabled Play control), and `Reserve character` on every empty slot.
- **Characters, Early Access while closed** — **EARLY ACCESS ENABLED**, "You
  can play now. Public Soft Alpha opens October 27.", the countdown, and the
  normal Play actions. There is no in-game countdown or HUD.
- **Characters, public gameplay open** — the normal playable experience.
- **Public landing, closed** — status `SOFT ALPHA — OCTOBER 27`, the locked hero line
  and supporting copy, the signed-out `Reserve your characters` CTA with
  `Sign in`, and the countdown beside them.
- **Public landing, open** — status `SOFT ALPHA — LIVE`, the same hero line,
  play-now supporting copy, and a signed-out `Start playing` CTA (still to
  `/register`); no countdown.

The landing reads the public switch only (never Early Access), rendered on the
server per request. The state-dependent strings — hero status, supporting
copy, CTA label, Build signal badge and status, and the final call-to-action
line — live together in `publicLandingContent.gameplayState`
(`features/public-site/public-site-content.ts`); the rest of the landing is
written to be true in both states.

## Operator controls

Both controls live in the existing Operator Console and reuse its
authorization (`requireAdmin`), its confirm-before-commit control, and its
append-only audit. See `docs/admin-console.md`.

## Production rollout preflight

This sequencing is safety-critical. Do not change production or preview state
while developing.

1. **Before merging.** Confirm production registration is still closed (the
   four Turnstile/ZeptoMail values from `docs/authentication.md` unset) and
   that the issue #221 identity cutover has been applied. Accounts that were
   never cut over are unverified and are refused gameplay (fail-safe).
2. **Deploy, then migrate immediately.** Run `pnpm drizzle-kit migrate` from
   the RuneSpace application terminal in Coolify. Until it runs, the new code's
   access query fails (requests error closed, never open). Re-running must
   report nothing pending. Never use `drizzle-kit push`.
3. **Verify the closed gate in production.** On `/admin`, the PUBLIC GAMEPLAY
   panel shows `October 27, 2026 · 9:00 AM Pacific`, Current state `Closed`,
   and the countdown. With a verified account that has no Early Access,
   `/characters` shows the waiting state and a direct `/play/{id}` returns to
   Characters.
4. **Grant Early Access deliberately**, account by account, through the
   selected-character inspector's Account access panel. Each grant is audited.
   There is no blanket grant for existing testers.
5. **Only then enable registration** by configuring the four #221 values, and
   verify the proxy `X-Forwarded-For` assumption from `docs/authentication.md`.
   Ordinary verified accounts stay reservation-only.
6. **Launch day.** Open public gameplay with `Open Public Gameplay`. Reaching
   the target changes nothing on its own (the countdown reads **LAUNCH
   IMMINENT!**). `Close Public Gameplay` is the reversible emergency control;
   Early Access accounts keep playing while it is closed.

## Tests

- Unit: `tests/unit/gameplay-access.test.ts` (policy matrix),
  `tests/unit/soft-alpha-launch.test.ts` (countdown, target − 1 ms, exact
  target, after, open), `tests/unit/operator-audit-target.test.ts`,
  `tests/unit/gameplay-entrypoints.test.ts` (inventory guard).
- PostgreSQL: `tests/integration/gameplay-access.test.ts` (the seven-row
  matrix, every seam refused before lock/reconcile, reservation/portrait/news
  still available, account-wide grant, paired fields, atomic audit, no-op
  silence, rollback when the audit write fails, non-admin refusal, allowlist
  grants nothing) and `tests/integration/gameplay-access-migration.test.ts`
  (replay from the pre-#223 schema with existing character audit rows).
- Browser: `tests/e2e/gameplay-access.spec.ts` covers the issue's eight
  journeys. It is the only spec that changes the global switch; it runs
  serially in the chromium project only and restores Closed and the migrated
  target after every journey. Every other fixture account receives fixture
  Early Access (`tests/integration/fixtures.ts`, `tests/e2e/fixtures.ts`) so no
  other spec depends on the switch.
