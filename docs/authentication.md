# Authentication

Better Auth owns identity, sessions, and credential security; RuneSpace never
duplicates password or session storage (see `docs/architecture.md`). This
document is the authoritative operational and security contract for Better Auth
configuration, trusted hosts and origins, cookies, and auth-specific environment
variables. It is **not** database migration procedure (see
`docs/deployment-database.md`) and **not** general application architecture.

## Host and origin boundary

`server/auth-options.ts` configures Better Auth with a **dynamic `baseURL`**
object so one build serves production and per-PR previews. The approved host
allowlist is exactly:

- `runespace.qcfailed.com`
- `pr-*.runespace.qcfailed.com`
- `localhost:*`
- `127.0.0.1:*`

with `protocol: "auto"` and **no fallback**: a request whose host is not in the
allowlist fails closed. Do not broaden this list (no `*.qcfailed.com`, no
arbitrary forwarded, preview, or sslip hosts), do not disable CSRF or origin
checks, and do not enable cross-subdomain cookies; production and each preview
keep independent host-only cookies. The allowed hosts are also the trusted-origin
boundary — do not add a separate `trustedOrigins` list that duplicates them.

`BETTER_AUTH_URL` is **not required** and is no longer read by `server/env.ts`,
CI, or the canonical E2E runner; the dynamic `baseURL` makes it obsolete. A stale
value may still exist in Coolify until cleanup: after this configuration is
merged, remove `BETTER_AUTH_URL` from the RuneSpace Coolify environment.
`BETTER_AUTH_SECRET` remains required (minimum 16 characters in production) and
must never be printed or committed.

## Browser-session security

Better Auth derives cookie `Secure`/attributes from the resolved protocol and
environment. In production mode it issues `Secure` cookies, which an HTTP origin
cannot store. Production and preview deployments run over HTTPS and keep this
default. The only exception is the canonical E2E runner, which runs the
production server over plain HTTP; see `docs/testing-strategy.md` for the
`RUNESPACE_E2E_CANONICAL_HTTP` gate that disables `Secure` cookies for that
runner alone. Never generalize that exception to CI, preview, or production, and
never gate it on a generic `CI` flag.
