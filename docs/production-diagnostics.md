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
  Client-side stale-tab detection via `clientReleaseId` is unavailable in
  Coolify deployments unless build-time identity is configured later; that is
  optional work unrelated to #75.

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

The receiver accepts only same-origin JSON browser requests and has a small, expiring in-memory process rate guard (30 reports/minute). This is deliberately not distributed across application replicas; Coolify ingress protections remain the appropriate production control for volumetric abuse.
