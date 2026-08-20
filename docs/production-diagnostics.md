# Production diagnostics and play recovery

RuneSpace writes structured `runespace.diagnostic` JSON records to application stderr. In Coolify, open the application logs and search the safe Next.js `digest` or the client `incidentId` displayed on the play-route fault screen. A client incident is shown only after the receiver accepts it. Browser reports use the same record and are posted only to the same-origin `/api/diagnostics` endpoint. A stale tab is visible as differing `clientReleaseId` and `serverReleaseId` fields.

Set the same `RUNESPACE_RELEASE_ID` to the deployed commit SHA in Coolify for both the **production image build** and the **application runtime** so a live deployment can answer which source revision it was built from. The build-time value is exposed as `NEXT_PUBLIC_RUNESPACE_RELEASE_ID`; the runtime value becomes `serverReleaseId`, so stale tabs remain visible rather than overwriting one another. GitHub Actions sets it to `${{ github.sha }}` for production-like builds and Playwright. When present, it is used as Next's `deploymentId`, enabling its supported version-skew protection without generating process-local IDs. Local canonical E2E uses the synthetic value `local-ci-parity`.

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

### Coolify source-revision wiring (operator step)

As of this issue, **`RUNESPACE_RELEASE_ID` is not present** in the production
RuneSpace app's Coolify environment (verified 2026-08-20 via the Coolify API:
the key does not appear among the app's build/runtime variables). Production
currently ships with no build revision stamped, so `/api/build-info` returns
`unknown`. Supplying the exact source revision is a **one-time operator step**
on the Coolify/OpenChamber host — repository code cannot set it from here:

1. In the Coolify RuneSpace application → **Environment Variables**, add
   ```text
   RUNESPACE_RELEASE_ID=$SOURCE_COMMIT
   ```
   `$SOURCE_COMMIT` is Coolify's predefined build variable that carries the
   commit hash of the source code for git-based resources
   (docs: `coolify.io/docs/knowledge-base/environment-variables#predefined-variables`).
   Leave **Build Variable** enabled so the exact SHA is baked into the image at
   build time (that is what stamps `NEXT_PUBLIC_RUNESPACE_RELEASE_ID` and Next's
   `deploymentId`, and what the runtime reports).
2. In the application's **General** settings, enable **"Include Source Commit
   in Build"** — Coolify excludes `SOURCE_COMMIT` from builds by default to
   preserve layer cache, so this toggle is required for the value to exist in
   the build environment.
3. Redeploy so the value is stamped into the artifact.

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

Until this step is completed, do **not** claim that a deployed preview or
production revision has been operational verified — the endpoint must report
the exact expected SHA (see `docs/development-workflow.md` →
"Exact-preview-revision verification").

Reports deliberately contain only a coarse route (`/play/[characterId]`), error metadata, a truncated stack, release, browser-online state, platform, and whether Mining was active. Header values, labeled credentials or secrets, and JSON-like state fragments are redacted as whole values or lines. They never include cookies, auth/session data, email/name, character IDs, raw URLs, database rows, or game state.

To verify recovery safely, use browser request interception/abort for a Mining Server Action request in Playwright. The console keeps the last server-confirmed state, shows **Comms interruption**, and exposes one manual retry; it does not retry automatically. Expected server-returned domain errors continue to display normally.

The receiver accepts only same-origin JSON browser requests and has a small, expiring in-memory process rate guard (30 reports/minute). This is deliberately not distributed across application replicas; Coolify ingress protections remain the appropriate production control for volumetric abuse.
