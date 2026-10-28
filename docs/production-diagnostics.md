# Production diagnostics and play recovery

RuneSpace writes structured `runespace.diagnostic` JSON records to application stderr. In Coolify, open the application logs and search the safe Next.js `digest` or the client `incidentId` displayed on the play-route fault screen. A client incident is shown only after the receiver accepts it. Browser reports use the same record and are posted only to the same-origin `/api/diagnostics` endpoint. A stale tab is visible as differing `clientReleaseId` and `serverReleaseId` fields.

`RUNESPACE_RELEASE_ID` is RuneSpace's single release identity. A deployment can
carry it in two independent ways that answer different questions:

- **Runtime identity** — `process.env.RUNESPACE_RELEASE_ID`, read live by the
  server as `serverReleaseId` and by `GET /api/build-info`. In Coolify this is
  configured as a **runtime-only** variable set to `$SOURCE_COMMIT` (the
  deployed commit hash). This is the identity Issue #75's exact-preview
  verification relies on.
- **Optional build-time identity** — only present when the variable is also set
  in the *build* environment. It is baked into `NEXT_PUBLIC_RUNESPACE_RELEASE_ID`
  (client `clientReleaseId`) and Next's `deploymentId`. It is **not** required
  for #75 and is intentionally **not** configured as a build-time variable in
  Coolify (setting it at build time would import the commit into the build
  context and invalidate the Docker layer cache on every commit). The
  browser/build-time release ID is therefore **not populated** in Coolify.

GitHub Actions sets `RUNESPACE_RELEASE_ID` to `${{ github.sha }}` for
production-like builds and Playwright (that is build-time); local canonical E2E
uses the synthetic value `local-ci-parity`.

### Reading the deployed source revision

`GET /api/build-info` is the public-safe, unauthenticated boundary that answers
"which source revision is this deployment serving?" It returns exactly:

```json
{ "releaseId": "<exact deployed source revision or 'unknown'>" }
```

It reuses the single `RUNESPACE_RELEASE_ID` release architecture (the same
sanitizing `releaseId()` helper the diagnostics server uses) — there is no
second release/version system. It exposes no database identity, secrets,
environment dump, private topology, container id, or user data, sets
`cache-control: no-store` so it reflects the actually-deployed runtime (never a
stale cached copy), and returns the explicit value `"unknown"` when no release
metadata is present rather than manufacturing one.

### Coolify release-identity configuration (runtime)

For Issue #75, exact preview (and production) source-revision verification is a
**runtime deployment-identity** concern. `GET /api/build-info` and server
diagnostics read `process.env.RUNESPACE_RELEASE_ID` at runtime, so the operator
configures it as a **runtime-only** Coolify variable — no per-commit build-cache
penalty:

1. In the Coolify RuneSpace application → **Environment Variables**, add
   ```text
   RUNESPACE_RELEASE_ID=$SOURCE_COMMIT
   ```
   `$SOURCE_COMMIT` is Coolify's predefined variable carrying the deployed
   commit hash for git-based resources
   (docs: `coolify.io/docs/knowledge-base/environment-variables#predefined-variables`).
   Configure it as a **Runtime Variable only** (`Build Variable` disabled).
2. Redeploy the application/preview and confirm `/api/build-info` reports the
   expected SHA.

This deliberately does **not** set the build-time value:

- Baking the SHA into the build (`NEXT_PUBLIC_RUNESPACE_RELEASE_ID` / Next
  `deploymentId`) imports the commit into the build context and invalidates the
  Docker layer cache on every commit; that is intentionally avoided.
- The browser/build-time release ID is therefore **not populated** in Coolify.
  Diagnostics' `clientReleaseId` is therefore empty in Coolify deployments. An
  open tab's own identity does not need it: see "Open tabs and new deployments"
  below, which uses the runtime value the server renders into the document.

Caveats to verify on the Coolify host before treating a preview as verified:

- Coolify's env-variable value interpolation (`$SOURCE_COMMIT`) is the intended
  mechanism; the value itself is not readable through the public API (values
  are masked).
- A known Coolify issue reports `SOURCE_COMMIT` as the literal string `HEAD` for
  some **PR-preview** deployments (coollabsio/coolify#2126). If a preview
  reports `HEAD`, treat it as **unverified**, not current — and confirm whether
  the deployed image actually received the PR head SHA.
- The exact preview PostgreSQL resource/logical-database name is not visible to
  repository code; confirm it from the Coolify host before relying on it.

Because env values are masked via the API, the shipped wiring is validated
behaviorally: after the operator redeploys, `/api/build-info` must report the
exact expected SHA (see `docs/development-workflow.md` →
"Exact-preview-revision verification").

Reports deliberately contain only a coarse route (`/play/[characterId]`), error metadata, a truncated stack, release, browser-online state, platform, and whether Mining was active. Header values, labeled credentials or secrets, and JSON-like state fragments are redacted as whole values or lines. They never include cookies, auth/session data, email/name, character IDs, raw URLs, database rows, or game state.

To verify recovery safely, use browser request interception/abort for a Mining Server Action request in Playwright. The console keeps the last server-confirmed state, shows **Comms interruption**, and exposes one manual retry; it does not retry automatically. Expected server-returned domain errors continue to display normally.

### The Play fault screen and Retry connection (#412)

The fault screen appears when the Play route itself failed to render on the server: a database that was unreachable or missing a table (a deploy that ran ahead of its migrations), or any other thrown server error. Next's error-boundary `reset()` does not retry that. It re-renders the boundary's children from the payload that already failed and sends no request, so the screen stayed up after the server recovered and only a manual browser refresh cleared it. **Retry connection** is therefore a full document load (`window.location.reload()`): it asks the server again, and if the server is still failing the fault screen comes back with a new incident reference. A reload also replaces a tab left on an older build, but a communications error is not assumed to mean one; a transient server failure and a stale tab are separate problems with separate mechanisms. Gameplay is server-authoritative, so a reload only rebuilds presentation from persisted state and never repeats a command.

### Open tabs and new deployments (#412)

Next.js does nothing for a tab that is already open. Verified with two real builds on one origin: after build B went live, a tab on build A kept executing A, through a background/resume, a server action and a client-side navigation; no existing mechanism updated it. (`next.config.ts` sets Next's `deploymentId` only from a *build-time* release id, which Coolify intentionally does not configure.)

`features/deployment/ReleaseWatcher` closes that gap with the existing `RUNESPACE_RELEASE_ID` and no new version system, dependency, service worker or deployment setting:

- **Own identity.** The server renders its runtime `releaseId()` into the Characters and Play pages as a prop. The first value the document sees is fixed for the life of the document (`captureDocumentRelease`), so a client-side navigation after a deployment, whose payload comes from the newer release, cannot make old JavaScript look current. A document with no release identity never reloads.
- **Checks.** While the tab is visible it reads `/api/build-info` every 60 seconds, and immediately when the tab becomes visible again or the browser comes back online. A hidden tab asks nothing. A failed request, a non-200 answer, malformed JSON, `"unknown"` or an invalid value changes nothing; only a valid release different from the document's counts as a deployment. If the live release returns to the document's own (a rollback), the pending update is dropped.
- **Update.** A real document reload, never `router.refresh()` or `reset()`, which keep the old JavaScript.
- **Deferral.** Inside Play the reload waits while a command or background reconciliation holds the command gate, while a Scavenge window is unclaimed and unexpired or a Scavenge reveal awaits acknowledgment, and while the character is in an accepted Trade session (`features/play/update-deferral.ts`). Anywhere, it also waits while the focused field holds typed text. Mining, Refining, Travel, Flight and passenger journeys are persisted by the server and reconcile on load, so they do not defer it.
- **No loops.** One automatic reload per target release per 10 minutes, recorded in `sessionStorage` (it survives the reload). A reloaded document that still reports an older release, such as replicas mid-rollout, retries after the cooldown and not before. If the attempt cannot be recorded, no reload happens.

A tab that last loaded a document before this shipped has no watcher; it needs one manual refresh, after which it updates itself.

### Two-build deployment and playtest procedure

Automated: `tests/e2e/release-update.spec.ts` builds two production bundles (B drops the E2E Play-fault trigger, so its chunks differ), deploys them in turn onto one origin with distinct runtime `RUNESPACE_RELEASE_ID`s, and keeps one browser tab and session across the swap. It covers a background tab resuming after a deployment with a Mining run in progress, the 60-second poll, a server that is down or reports no identity, a command held in flight, a rollout that never converges, and **Retry connection** recovering after a transient server fault for both a document load and a route navigation.

Manual, on a preview or local production build with a disposable database (never production):

1. Build and serve build A with `RUNESPACE_RELEASE_ID` set at runtime only. Open Play on a character with a Cutter at The Jag, start Mining, and note the Mining progress, Credits and Inventory.
2. Put the tab in the background (another tab or minimized window).
3. Make a visible client change, build B, and deploy it with a new release id. While it restarts, return to the tab: nothing should break or reload (the check fails and is ignored).
4. After B answers `/api/build-info`, foreground the tab. It reloads onto B at once: the change shows, Mining is still running with the same progress, and Credits and Inventory are unchanged with no duplicated reward.
5. Repeat with the tab visible the whole time: it updates within about a minute.
6. Repeat with a Trade session open, or during an unclaimed Scavenge window: no reload until the session ends or the window is claimed or expires.
7. Transient server failure: with Play open, make the Play route fail for one character in the disposable database (for example point `characters.current_location_id` at an unknown location id). Reload to reach the fault screen, press **Retry connection** (it must show the fault again while the fault remains), repair the row, press it again: Play returns without a browser refresh.

The receiver accepts only same-origin JSON browser requests and has a small, expiring in-memory process rate guard (30 reports/minute). This is deliberately not distributed across application replicas; Coolify ingress protections remain the appropriate production control for volumetric abuse.
