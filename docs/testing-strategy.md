# Testing Strategy

RuneSpace uses a **risk-based** testing strategy. Tests focus on where bugs and
exploits are most costly: pure domain rules, server/persistence boundaries, and a
small number of critical mobile player journeys.

## 1. Unit tests (Vitest)
- Target: **pure domain rules** in `game/domain/` — calculations, state
  transitions, and validation contracts in `game/schemas/`.
- Environment: `node` (no DOM needed for pure logic).
- Must be fast, deterministic, and free of network/DB.
- Foundational timing, inventory, and progression rules have focused unit
  coverage alongside the content-ID contract.
- Run: `pnpm test`.

## 2. Integration tests
- Target: **server/persistence boundaries** — command handlers in `server/`,
  Drizzle queries in `db/`, and end-to-end resolution of player intent against a
  real (or test) database.
- These assert that domain outcomes are actually persisted and that the server
  is the authority. Ownership and gameplay-foundation tests run against the
  PostgreSQL service in the dedicated CI job and via `pnpm test:integration`.
- Vitest runs integration files in parallel workers against **one** disposable
  database, so a file's assertions must not depend on global state another file
  can change mid-run. The global public-gameplay switch is the coordinated case
  (issue #277): `tests/integration/gameplay-access.test.ts` is its only writer
  and holds `holdPublicGameplaySwitch` (a PostgreSQL advisory lock) for each
  test, restoring Closed before releasing it. Any assertion elsewhere that is
  only true while gameplay is Closed — a gated account is refused, access is
  granted `via: "early_access"` — runs inside `withPublicGameplayClosed`
  (`tests/integration/fixtures.ts`), which waits for the writer and confirms
  Closed. Fixture accounts carry fixture Early Access, so ordinary gameplay
  assertions need neither.

## 3. Browser tests (Playwright)
- Target: a **small number** of important mobile player journeys (the smoke
  screen, then core loops as they ship). Avoid large suites of shallow UI tests.
- The landing page has a minimal app-loading smoke test
  (`tests/e2e/smoke.spec.ts`) that protects durable landing identity and entry navigation.
- Playwright source is type-checked before it is ever run. Every committed
  `.ts` file under `tests/e2e/**` (specs and helpers) is part of the one strict
  `tsconfig.json` program (issue #212), so a stale import, renamed export, or
  impossible type fails `pnpm typecheck`, and therefore the always-on
  `fast-checks` CI job, before any PostgreSQL, build, or browser work. There is
  no separate E2E typecheck command, and E2E files must not be excluded from
  `tsconfig.json` or silenced with `any` or `@ts-nocheck`. This is a static
  check only: it says nothing about browser behavior, which only the focused and
  canonical Playwright runs prove.
- Quick local development: `pnpm test:e2e`. It uses the production server by
  default and may reuse an existing server outside CI; set
  `PLAYWRIGHT_DEV_SERVER=true` for a development server. It does **not** count
  as CI-parity validation. On the managed RuneSpace host, plain `pnpm test:e2e`
  does not take the host-wide E2E lock (#251) and defaults to port `3000`, so do
  not run it on a managed host or on Hermes at all — use
  `pnpm test:e2e:focused <phase>` for managed-host iteration instead.
- The canonical CI-parity command: `pnpm test:e2e:canonical`. This is the single
  source of truth for local and CI behavioral verification. Its canonical
  selection is an explicit allowlist of behavioral specs — `canonicalSpecPattern`
  in `playwright.config.ts` is its single source of truth — covering Mining,
  Inventory Equip, Overlay, Character, Walk It Off, Cut Your Teeth, Travel,
  Location Population, Character Profile, Character Portraits, Refining, Bounded
  Runs, Cargo Hold, Deep Jag, Fabrication (Tier 1, and Fabrication 5 and 8 with the Loadsteel
  Cutter, the Freight Harness and their Missions — #233), Holo Hollow, Rusk Recovery, Admin Operator, Sign-out,
  Account News, Account Verification, Gameplay Access, and the Chat/Social shell and
  realtime stream (`social-shell`, #245), and General/Trade public chat
  (`public-chat`, #246), Whispers, Block, and Report (`whispers-safety`,
  #247), moderation review, sanctions, notices, and appeals (`moderation`,
  #248), player trading (`player-trading`, #268), and the read-only System
  conversation for recipe unlocks (`system-notices`, #274), and public `@mentions`,
  blocked-player placeholders, and Whisper hide (`chat-social-polish`, #261). It intentionally excludes noncanonical `smoke`, `ownership`,
  `design-system`, `work-orders`, `public-*`, and QC Studio specs. It:
  - requires Node 22.x
  - requires a localhost-only disposable PostgreSQL database (refuses remote)
  - selects a dedicated test port
  - removes stale Playwright output and creates run-scoped worker state paths
  - runs committed migrations
  - runs one production build and starts one long-lived production server, then
    invokes Playwright once with the canonical allowlist and Chromium project
  - authenticates once per Playwright worker and creates a fresh authoritative
    test character for each test; special registration, character-creation,
    portrait, ownership, admin, sign-out, and account-news journeys keep their
    own contracts
  - the Power Annex journey uses a disposable runner-only clock file, gated to
    CI against localhost PostgreSQL, to cross a Pacific reset boundary without
    depending on the host wall clock
  - runs with zero retries, `trace: "retain-on-failure"`, and a timing reporter
    that prints total wall-clock time and the ten slowest tests; the admin
    operator suite is an intentional serial exception for its fixed allowlist
    and identity, and the gameplay-access suite (issue #223) is the other: it
    is the only spec that changes the global public-gameplay row, so it runs
    serially in the chromium project only and restores Closed after every
    journey, while every other fixture account carries fixture Early Access
  - on failure, Playwright's `screenshot: "only-on-failure"` and
    `trace: "retain-on-failure"` write per-test screenshots and traces into
    `test-results/`; CI uploads those as a bounded failure-diagnostics artifact
    regardless of screenshot review
  - runs as three independent GitHub Actions shards, each with its own
    PostgreSQL service, disposable database, migrations, production server, and
    shard-named diagnostics/timing artifacts; all three are required by Full
    and Merge gates
  - captures the curated review manifest only in a separate deterministic,
    unsharded one-worker job when `RUNESPACE_E2E_SCREENSHOTS=true` is explicitly
    requested through the `e2e-screenshots` label. The ordinary behavioral
    shards perform no curated screenshot I/O. The screenshot lane uses the same
    canonical selection and fixture contracts, verifies every expected file,
    and uploads `artifacts/e2e-review/`.
  - `test-results/` belongs to an individual Playwright invocation and may be
    cleaned or replaced by a later invocation (the focused runner does exactly
    that). Failure diagnostics are bounded to failing tests. Curated screenshots
    are produced only by the separate screenshot lane, which copies and
    verifies them under `artifacts/e2e-review/`; expected behavioral-shard
    cleanup is not lost output.
  - sets `RUNESPACE_E2E_CANONICAL_HTTP=true`, which disables Better Auth `Secure`
    cookies for the local production E2E runners (canonical and focused) only.
    Production-mode Better Auth issues `Secure`
    cookies that a plain-HTTP test origin (`http://127.0.0.1:<port>`) discards,
    dropping the session after sign-up; this gate is a test-runner-only exception
    (see `docs/authentication.md`). It applies only to the plain-HTTP loopback
    server those runners own, including canonical execution in GitHub Actions;
    it is never set for the ordinary CI build job, for previews, or for
    production.
- Every local E2E server also receives the account-boundary settings from
  `accountBoundaryE2eEnv` in `scripts/e2e-shared.mjs` (issue #221): test-only
  Turnstile keys, Turnstile site verification redirected to the server's own
  gated loopback stub (`app/api/e2e/turnstile-siteverify`, a 404 outside the
  local-E2E gate), and a run-scoped `RUNESPACE_E2E_MAIL_OUTBOX_FILE` that
  captures verification email. Registration journeys serve a local Turnstile
  stand-in script, give each journey its own client address through
  `X-Forwarded-For`, and follow the exact emailed link
  (`tests/e2e/account-helpers.ts`); no browser test calls Cloudflare or
  ZeptoMail. Specs that only need a signed-in player keep using
  `establishAuthenticatedSession`, which creates an explicitly verified
  account with a fixture Player name.
- Database isolation is automatic for the supported test entry points. The
  `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:e2e:focused`, and
  `pnpm test:e2e:canonical` commands derive a uniquely named local disposable
  database from the configured PostgreSQL server, apply migrations there, run
  the command, and force-drop that database in cleanup. They never use the
  persistent development database for fixtures. The `*:raw` scripts are
  internal runner targets and refuse to run unless the disposable database
  marker matches the selected database name.
- Agents may not report browser or CI parity as passing unless the canonical
  command actually passed. When a change adds or touches E2E specs, run the
  new/targeted spec(s) first in isolation and **then** the full
  `pnpm test:e2e:canonical` suite — `fast-checks` (typecheck/lint/unit/build)
  intentionally skips PostgreSQL integration and canonical E2E, so a green fast
  run is not evidence the merge gate will pass. For details see
  `AGENTS.md` §6 and `docs/development-workflow.md` (§Focused implementation
  checks, then full canonical parity).
- The canonical command is expensive by design: one invocation performs one
  full production `next build`, one `next start`, and the complete allowlisted
  selection, so it spans several minutes. For focused local iteration, run the
  affected spec (`pnpm test:e2e <spec> --project=chromium` on an unmanaged
  machine; on a managed host use `pnpm test:e2e:focused <phase>`).
  Ordinary `pnpm test:e2e` owns its server: it uses production build/start by
  default, or a development server when `PLAYWRIGHT_DEV_SERVER=true` is set.
  Focused evidence is never a substitute for the canonical command — only
  `pnpm test:e2e:canonical` and the matching CI job establish CI parity.
- Managed-host focused iteration uses `pnpm test:e2e:focused <phase>` (currently
  `mining`, `character-profile`, `location-population`, `character-portraits`,
  `cargo-hold`, `inventory-equip`, `travel`, `walk-it-off`, `cut-your-teeth`,
  `refining`, `bounded-runs`, `rusk-recovery`, `fabrication` (which also selects
  `fabrication-advanced.spec.ts`), `work-orders`, `gameplay-access`, and `account-verification`; recipe
  in `docs/development-workflow.md`). The focused runner
  reuses the canonical primitives from `scripts/e2e-shared.mjs` (localhost-only
  database safety, Node 22 validation, port availability, targeted process
  termination, and the host-wide lock that runs one local E2E lifecycle at a
  time across worktrees) and owns a separate high port (default `3310`, never `3000` or
  `3200`), a local build-and-runtime auth placeholder, and a small lifecycle:
  per-invocation output cleanup, migrations, one production build and server, the
  selected phase, then deterministic teardown of only its own processes.
  Focused results are iteration evidence only; only `pnpm test:e2e:canonical`
  and the matching CI job establish CI parity.
- GitHub Actions remains the final authority; canonical execution must use the
  same `pnpm test:e2e:canonical` command.

### Issue #145 surface coverage

The dedicated Play-surface change has focused coverage for the boundaries that
cannot be proven by server tests alone:

- `tests/unit/journey-feed.test.ts` proves that Journey feed entries derive
  presentation from the authoritative Travel/Scavenge projection without
  owning commands or persistence.
- `tests/unit/map-destination.test.ts` and the Mission edge-cue cases in
  `tests/unit/local-map-scroll-affordances.test.ts` (#240) prove the Map's
  selected-destination state and off-screen Mission cues are projections of
  existing adjacency, location-state, and Mission-guidance facts; the browser
  behaviour (sticky panel, dismissal, Details, arrow geometry, cues, newest-first
  Journey) is proven in `tests/e2e/travel.spec.ts`.
- Location Population and Character Profile E2E coverage proves that
  same-location browsing remains on Location and is absent from Map; the
  stationary Long Scramble composition has scene/description/population and no
  activity placeholder.
- Travel E2E coverage opens Map during an active Travel, keeps the Map URL
  mounted through authoritative arrival, and proves route/transit treatment
  clears, Back changes to Location, and stationary Map interaction is restored.
- Overlay and Inventory/Equipment E2E coverage proves the four footer
  destinations and the shared tabbed overlay while retaining existing
  server-confirmed loadout and inventory behavior. Mission equipment guidance
  also proves the shared Play entry point can open Equipment directly.

These tests use the existing narrow authoritative character/state fixtures;
they do not reconstruct a full early-game progression solely to reach a UI
surface. The final CI-parity sequence follows `docs/development-workflow.md`:
run the normal committed migration check (`pnpm drizzle-kit migrate`) when the
managed disposable database is available, then typecheck, lint, format check,
unit tests, `pnpm test:integration`, build, focused E2E, and the full
`pnpm test:e2e:canonical` run, which runs on GitHub when working from the shared
Hermes host.

- Uploading an artifact is not proof that promised evidence exists. Verify each
  expected evidence file before upload, and inspect artifact contents whenever
  evidence is part of the definition of done.

### Issue #245 realtime/social coverage

- `tests/unit/realtime.test.ts` owns the wire format and incremental parser,
  audience matching and in-process fanout, the publisher's independence from
  chat/trading models, the browser connection lifecycle (reconcile on connect
  and reconnect, immediate reconnect after a deliberate close, backoff,
  watchdog, refusal stops), duplicate-safe shell state, and the launcher's
  accessible attention state.
- `tests/integration/realtime.test.ts` proves stream authorization against
  PostgreSQL: unauthenticated, foreign-character, and gameplay-access refusals
  (including revocation between streams), the server-derived scope, delivery
  only to matching streams across several tabs, heartbeat, and the bounded
  lifetime.
- `tests/e2e/social-shell.spec.ts` proves, at phone and desktop widths, the
  launcher's edge placement (flush right, centred in the usable viewport,
  through a rotation, no reserved page space — measured at the end of a page
  the spec stretches to overflow, because the natural page height depends on
  the host's fonts — clear of the Map's selected
  destination panel), the Drawer over the current
  surface, the accessible attention state and a pinned card driven through the
  real `SocialContext` seam, reconnect after the deliberate close, one stream
  per tab across several tabs, and recovery of a suspended, offline tab. It
  ends streams through the local-E2E-only `POST /api/e2e/realtime` hook instead
  of waiting out the 5-minute lifetime, and reaches the seam from the page's
  React fiber because no production feature raises attention yet.

### Issue #246 public chat coverage

- `tests/unit/chat.test.ts` owns the content contract (trim, empty, 280 code
  points, matching the database CHECK), the shared budget (General 5 / Trade 3
  on one count), the composer bands, the ad cooldown, the severe-term
  guardrail's whole-token matching against a stand-in term, and the browser
  feed's merge, ordering, gap restart, and dual-feed ad projection.
- `tests/integration/chat.test.ts` proves against PostgreSQL: server-derived
  immutable identity, foreign-character / gated / anonymous refusals, the
  budget across characters and concurrent requests, the promoted ad's atomic
  charge, one record in both feeds, its one shared send and account-wide
  cooldown (including a concurrent race), refused ads spending nothing,
  guardrail refusals persisting and delivering nothing, publish-after-commit,
  stable seq pagination across identical timestamps, and bounded 90-day
  retention.
- `tests/e2e/public-chat.spec.ts` proves at phone and desktop widths: switching
  channels in place, own/long messages without horizontal overflow, the
  promoted ad's treatment and its one record in both feeds, the 280-character
  and rate states counting down with no request, another tab's sends
  correcting the indicator through the server's refusal, load-older, live
  delivery, and a reconnect catching a missed message without duplicates. Each
  journey signs in a fresh account (its own budget) and looks only for its own
  tagged messages, because the feeds are game-wide. Canonical runs the
  chromium project only, so the journeys set the phone (393px) and desktop
  widths themselves; the multi-width ones skip the mobile project so the
  shared feed is never seeded twice at once.

### Issue #247 Whispers, Block, and Report coverage

- `tests/unit/chat.test.ts`, `tests/unit/social-safety.test.ts`, and
  `tests/unit/realtime.test.ts` own the pure rules: Whispers on General's limit
  of the shared count, the pair key, Whisper feed merging, the six report
  reasons, the optional note, and the publish audience that skips blockers.
- `tests/integration/social-safety.test.ts` proves against PostgreSQL: only an
  owned playable character sends; identity survives renames; offline
  recipients read durable history; latest 50 and pagination; unread durable
  per recipient character, cleared everywhere and never moved backwards; the
  shared budget across General, Whispers, and Trade; the guardrail on Whispers;
  Block across every character of both accounts, public suppression for the
  blocker only, Whispers refused both ways without disclosure, history kept,
  unblock, and the block/unblock signals; message and player reports, the
  10-before/10-after window from the right feed, no unrelated Whisper leakage,
  same-account dedupe, Report + Block, and evidence surviving retention.
- `tests/e2e/whispers-safety.spec.ts` proves with two real accounts at phone
  and desktop widths: starting a Whisper from a chat sender (its name), from
  the same-location profile, and by exact name with a character who is
  elsewhere, offline, and silent in public, without leaving Play, live arrival with unread on the
  launcher and the Whispers tab, reading on one tab clearing the other, the
  Block / Report / Report + Block flows, blocked public messages disappearing
  for the blocker only, Blocked Players unblocking, and no horizontal overflow.
  Like `public-chat`, its two-account journeys run in chromium only.

### Issue #274 System recipe-unlock coverage

- `tests/unit/recipe-unlocks.test.ts` owns derivation from the canonical
  recipe registries: no unlock without a level rise, every recipe at an exactly
  crossed level, nothing skipped when an award skips levels, nothing repeated
  below the previous level, nothing for a rise with no recipe or a skill with no
  registry, a newly authored recipe discovered with no notification-specific
  registration, output-plus-inputs naming for shared outputs, and one grouped
  message per progression event.
- `tests/unit/player-name.test.ts` and `tests/unit/character-name.test.ts`
  prove both validators refuse the whole-name System identity in its case,
  NFKC, spacing, digit, and Cyrillic look-alike forms, and do not
  substring-block `Systematic`, `Ecosystem`, or `Solar System`.
- `tests/integration/recipe-unlock-notices.test.ts` proves through the shared
  character command boundary: one grouped row for an exact or skipped-level
  crossing and none for a non-crossing or recipe-less rise, no repeat on later
  XP, the notice rolling back with its XP, the `"system.notice"` prompt only
  after commit, one row for two concurrent crossing commands, no row for the
  operator's SET TOTAL XP, durable once-only read state with a newer notice left
  unread, and owner-only reads.
- `tests/e2e/system-notices.spec.ts` proves at phone width that an ordinary
  Refining attempt crossing Refining 5 lights the launcher and Whispers tab
  live, System is pinned above a player conversation, it opens to the grouped
  notice with no composer, profile, Block, or Report, and reading it stays read
  across a reload — with no horizontal overflow. It also proves Something New to Make is
  the newest Update, linking the Mining & Refining and Fabrication & Tinkering
  Wiki pages, and that News surfaces it.

### Issue #248 moderation coverage

- `tests/unit/moderation.test.ts` owns the pure rules (sanction state,
  durations, exact-end expiry, reversal, appealability, notice currency,
  labels) and the production surface's guards: every export of
  `server/moderation-commands.ts` calls `requireAdmin`, none exposes an `*As`
  seam, and nothing under `server/`, `app/`, or `features/` updates or deletes
  an audit or note row.
- `tests/integration/moderation.test.ts` proves against PostgreSQL: non-admin
  refusal with no data and no audit row; one privileged-access row per
  sensitive read, written before data and rolled back with it; audited
  mutations and silent no-ops; reports joining and opening cases; preserved
  context and retained Whispers never reaching a third conversation;
  interpretable report/block counts; no reporter or moderator in any player
  view; a social restriction on every character of the account (sends, ads
  without a charge, Whispers, and the #225 trade seam) with public reads still
  allowed; suspension through the gameplay-access boundary; deterministic
  expiry, reversal, and duration changes; evidence kept under permanent
  suspension; and one appeal per sanction, decided once.
  `tests/integration/moderation-migration.test.ts` replays 0034's backfill.
- `tests/e2e/moderation.spec.ts` proves at phone and desktop widths: an
  operator reviewing, restricting, and deciding an appeal, with the live
  notice card and held composer for the player on every character; suspension
  returning an open Play tab to Characters while the appeal still works; the
  403 for ordinary players; the access log; and the published policies, footer
  links, the "Open Channels" Update, and its News attention.

### Issue #266 player trade request and session coverage

- `tests/unit/player-trade.test.ts` owns the pure rules: the policy numbers,
  exact 20-second expiry, movement invalidation, 5-minute session inactivity,
  and the rolling 4/30 budget. `tests/unit/player-trade-gate.test.ts` keeps
  the accepted-trade gate deny-by-default: the exact `allowDuringTrade`
  opt-outs, the gate under the row lock and before reconciliation, and the
  promoted-ad gate before its charge.
- `tests/integration/player-trade.test.ts` proves against PostgreSQL, with
  injected clocks and `Promise.all` races rather than sleeps: forged, remote,
  and blocked targets create nothing and publish nothing; Block across every
  character of both accounts; social restriction refusing initiation but not
  acceptance; one outgoing request under concurrent tabs (and the partial
  unique index itself); immediate, idempotent Cancel without cooldown;
  deterministic expiry; the account-wide 4/30 budget across characters and
  concurrent sends, untouched by refusals; same-recipient escalation;
  concurrent competing, chained, and crossed acceptances leaving each
  character in exactly one session; Accept-vs-Cancel and Accept-vs-expiry;
  movement invalidation, which stays final once the released requester acts;
  crossed and ring-shaped concurrent creations and acceptances without
  deadlock; a retried Accept after pruning; the accepting character's own
  outgoing request released; same-account sessions; guessed, foreign, and wrong-account ids;
  representative gameplay commands refused during a session or a pending
  outgoing request and allowed again after cancel or expiry; and the
  realtime prompts after commit.
- Browser coverage arrived with the trade UI in #268 (below).

### Issue #267 player trade offer, settlement, and audit coverage

- `tests/unit/player-trade.test.ts` also owns the consent phase rule and the
  Credit and stack-quantity validators. `tests/unit/player-trade-settlement.test.ts`
  owns the pure settlement planner: re-proof of both offers (balance, carried
  quantity, equipped, Cargo, and foreign instances), the explicit offers it
  returns for the audit, a full-Inventory one-for-one swap, stack merging into
  a partial stack, slot and mass overflow, a received container adding no
  capacity, and the last-Cutter guard (Cargo Cutters count, a Loadsteel Cutter
  only counts at Mining 5, Cutter-for-Cutter swaps), the empty-for-empty
  refusal, and the stored Credit limit.
- `tests/integration/player-trade-settlement.test.ts` is the primary proof,
  against PostgreSQL, of the adversarial invariants: every malformed, foreign,
  counterpart-side, nonparticipant, wrong-account, and stale mutation is
  refused with the session row and offer lines byte-for-byte unchanged; the
  server-owned version advances on every valid edit and clears both sides'
  consent, while setting Credits to the amount already offered changes and
  publishes nothing; stale Ready/Confirm cannot consent to a newer proposal;
  Ready and settlement both refuse a trade with nothing on either side, and a
  settlement that would overflow a stored Credit balance is a correctable
  refusal, not a database error;
  `Promise.all` races of both final Confirms, a duplicated final Confirm, and
  final Confirm against Cancel each end in exactly one legal world (one commit
  and one audit row, or no movement and no audit row); a commit moves exactly
  the agreed Credits, stacks, and the same unique instance with its charge,
  including a one-sided gift and a same-account trade; a deterministic
  database failure at the audit insert (a test-only trigger) rolls every
  transfer back; capacity, mass, received-container, and last-Cutter
  refusals return the session to a correctable compose state with nothing
  moved; ownership and location are re-proved at commit; offers, version, and
  consent survive a reload while idle expiry moves nothing, and a released
  character's gameplay command makes that expiry final before a waiting,
  earlier-clocked final Confirm can settle; retries and late
  Cancel/Ready/edits after completion are inert; the audit query seams; and the
  `updated`/`completed` realtime prompts, never sent for a refusal.
- `tests/unit/gameplay-entrypoints.test.ts` lists the eight #267 server actions
  and their shared stale-page recovery helper.

### Issue #268 player trading experience coverage

- `tests/unit/player-trade-presentation.test.ts` owns the presentation
  helpers: the stage derived from the server's phase and consent, stacks
  merged by item against what is offered, charge labels, and the requester's
  note wording (with a true generic line when the prompt was missed).
- `tests/integration/player-trade-settlement.test.ts` ("issue #268 durable
  trade outcomes") proves the reconcile reads: both participants learn how
  their latest session ended and exactly what a commit moved (the same
  instance with its charge), who canceled, an idle session reads as expired
  before anything writes it down, another pair's trade never leaks, and a
  refused settlement is explained to both participants from their own side
  until the next offer change. `tests/integration/character-profile.test.ts`
  proves `sameAccount` comes from account identity, not Player names.
- `tests/e2e/player-trading.spec.ts` (canonical, focused phase
  `player-trading`) is the representative browser contract with real
  accounts on separate contexts at the Crash Site: Nearby Players → profile →
  Trade, Waiting + Cancel Request, the live pinned card with launcher
  attention and no navigation or modal, Accept opening the surface for both,
  Credits + stack + a charged Cutter, independent Ready, an edit clearing
  consent in both clients, the frozen You Give / You Receive review, first
  Confirm waiting and the second completing for both (the Cutter keeps its
  charge), Cancel Request and Cancel Trade, a full-Inventory refusal returning
  both to a correctable state with the reason, a reload resuming the same
  session and version, a same-account trade with Trade alone on the profile,
  four rapid requests making Decline & Block prominent with the account's
  fifth refused, Block stopping further requests, and no horizontal overflow
  with the footer actions in view at 393px and 1280px. It also proves Meet Me
  There is published and links the Player Trading Wiki page (found by name
  since #274 shipped a newer Update). It never waits out the 20-second or 5-minute timers; the
  integration suites own those with injected clocks.

## What to test when systems arrive
For progression-sensitive systems, prioritize:
- **exploit-sensitive transitions** (e.g., granting rewards)
- **resource consumption** (fuel, materials)
- **replay / duplicate-claim prevention** (idempotent commands)
- **persistence correctness** (the stored state matches the resolved outcome)

## Choosing the cheapest reliable layer (ownership guide)

Every important behavior needs one **primary proof at the cheapest reliable
layer**. Higher layers add smoke coverage only where the higher layer itself is
part of the contract. Do not prove every requirement at every layer.

Decide top-down:

1. **Can the behavior be proven without PostgreSQL and without a browser?**
   Prove it in `tests/unit/`. Examples from the current suite:
   - pure formulas and balance derivation — `mining.test.ts`, `gameplay-foundations.test.ts`
   - deterministic domain transitions and cursor math — `gameplay-foundations.test.ts`
   - inventory planning and capacity rules — `planStackAddition`, `planExactStackAddition`
   - command-gate/scheduler model behavior — `command-gate.test.ts`
   - timing, IDs, validation schemas, route-progress geometry — `travel.test.ts`,
     `ids.test.ts`, `route-progress.test.ts`, `local-map-layout.test.ts`

2. **Is persistence, concurrency, or ownership the point of the behavior?**
   Prove it in `tests/integration/` against real PostgreSQL. The browser cannot
   prove that a durable cursor, charge, claim, or reward was committed exactly
   once. Examples: transaction rollback, row-lock serialization, constraint and
   migration behavior, ownership boundaries, atomic multi-row gameplay commands
   (`gameplay-foundations.test.ts`, `travel.test.ts`, `power-annex.test.ts`,
   `power-cell-boost.test.ts`).

3. **Is the browser itself part of the contract?**
   Prove it in `tests/e2e/`. Keep the journey representative rather than
   exhaustive. Examples: automatic Mining/Travel boundary reconciliation
   (browser timers), overlay focus/scroll-lock/keyboard behavior, accessible
   names and announcements, responsive mobile layout, and rendering integration
   that cannot be trusted from unit or database tests alone. E2E should **not**
   re-prove every server formula, persistence branch, or edge case already
   covered below it.

When a behavior already has a primary proof at a cheaper layer, higher-layer
tests assert only the *layer-specific* outcome:
- a unit test proves boosted Mining timing and charge math;
- the integration test proves charge/XP/cursor commit and rollback as one unit;
- the E2E test proves the boosted-timer boundary reconciles automatically in the
  browser — it does not re-derive the timing table.

Only keep visual assertions that encode an approved durable layout/accessibility
contract or protect a demonstrated regression. Do not assert exact token colors
or pixel values (the `--rs-*` tokens in `app/globals.css` are the single source
of truth); do assert that a layer actually paints (never a dropped-transparent
layer) where that regression class is documented.

Before adding a new test, search the layer below it: if the behavior is already
proved there, prefer strengthening that proof or moving the assertion down.
Before removing or weakening a test, record where the behavior remains protected.

## Avoid
- Test duplication across layers.
- Excessive shallow component tests that assert markup without behavior.
- Testing implementation details instead of observable outcomes.
- Rewriting server state from the test process (for example moving an
  `active_actions` cursor back to fast-forward a timer) straight after a click.
  The click does not wait for its server command, so the write can land first,
  match nothing, and leave the test passing or failing on wall-clock timing
  (#243). Wait for a state only the committed command can render (such as
  `Stop Mining`) first, and make a fast-forward helper fail when it moves no
  row.

## CI scope and event matrix

The `CI` workflow always runs the fast job (frozen install, typecheck of the app
and every test including `tests/e2e`, lint, format check, unit tests, and one
production build) for PR revisions and pushes
to `main`. PostgreSQL integration and canonical E2E are selected by the explicit
full-gate policy and start only after the fast job succeeds, so a typecheck, lint,
unit, or build failure (including in `tests/e2e`) never spends integration or
browser minutes:

| Event | Fast checks | PostgreSQL + canonical E2E | Merge gate |
| --- | --- | --- | --- |
| Draft PR opened, reopened, or pushed | Yes | No | Intentionally unsatisfied |
| `full-ci` applied to a draft | Yes | Yes | Intentionally unsatisfied |
| Push while `full-ci` remains applied | Yes | Yes | Intentionally unsatisfied while draft |
| Draft converted to ready | Yes | Yes, without a code push | Required |
| Push to a ready PR | Yes | Yes | Required |
| Push to `main` | Yes | Yes | Required |
| Manual `workflow_dispatch` (`--ref <branch>` plus the `ref` input) | Yes | Yes | Required |

Labels on ready PRs request the full gate; adding `e2e-screenshots` also runs the
separate deterministic screenshot lane without adding its output to behavioral
shards. PR runs use a per-PR concurrency group so obsolete work is canceled only
for that PR; main and manual runs use unique groups. The static `Merge gate` is required and
intentionally fails on draft checkpoints. This is necessary because GitHub
marks a skipped required job successful; a green draft decision would otherwise
be reusable when the PR becomes ready without a new commit. Require only the
fast check and `Merge gate` in the `main` branch protection/ruleset; this
repository currently has no such protection configured — API-verified for
Issue #61 on 2026-08-03 (the GitHub REST branch-protection endpoint returns
`Branch not protected`, and the repository rulesets list is empty) — so a
maintainer must verify those settings separately. Treat that snapshot as dated
repository state and re-verify before acting on it.

CI retains a separate PostgreSQL integration job, a three-shard canonical E2E
matrix, and an opt-in unsharded screenshot lane. The canonical runner is the
single source of truth for E2E behavioral verification in both local development
and GitHub Actions; curated screenshots are produced and uploaded only in the
explicit screenshot lane (see §3), and per-failure diagnostics are always
retained with shard-specific artifact names.
