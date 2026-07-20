# Production diagnostics and play recovery

RuneSpace writes structured `runespace.diagnostic` JSON records to application stderr. In Coolify, open the application logs and search the safe Next.js `digest` or the client `incidentId` displayed on the play-route fault screen. A client incident is shown only after the receiver accepts it. Browser reports use the same record and are posted only to the same-origin `/api/diagnostics` endpoint. A stale tab is visible as differing `clientReleaseId` and `serverReleaseId` fields.

Set the same `RUNESPACE_RELEASE_ID` to the deployed commit SHA in Coolify for both the **production image build** and the **application runtime**. Coolify's deployment/commit variable may be mapped to it. It is optional for local development. The build-time value is exposed as `NEXT_PUBLIC_RUNESPACE_RELEASE_ID`; the runtime value becomes `serverReleaseId`, so stale tabs remain visible rather than overwriting one another. GitHub Actions sets it to `${{ github.sha }}` for production-like builds and Playwright. When present, it is used as Next's `deploymentId`, enabling its supported version-skew protection without generating process-local IDs.

Reports deliberately contain only a coarse route (`/play/[characterId]`), error metadata, a truncated stack, release, browser-online state, platform, and whether Mining was active. They never include cookies, auth/session data, email/name, character IDs, raw URLs, database rows, or game state.

To verify recovery safely, use browser request interception/abort for a Mining Server Action request in Playwright. The console keeps the last server-confirmed state, shows **Comms interruption**, and exposes one manual retry; it does not retry automatically. Expected server-returned domain errors continue to display normally.

The receiver accepts only same-origin JSON browser requests and has a small, expiring in-memory process rate guard (30 reports/minute). This is deliberately not distributed across application replicas; Coolify ingress protections remain the appropriate production control for volumetric abuse.
