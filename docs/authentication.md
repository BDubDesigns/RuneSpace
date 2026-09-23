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
default. The only exceptions are the repository's local production E2E runners
(the canonical runner and the focused runner from `docs/development-workflow.md`),
which run the production server over plain HTTP; see `docs/testing-strategy.md`
for the `RUNESPACE_E2E_CANONICAL_HTTP` gate that disables `Secure` cookies for
those runners alone. The gate applies only to the plain-HTTP loopback server
the runner itself owns — including canonical execution in GitHub Actions — and
is never set for the ordinary CI build job, previews, or deployments, and never
gated on a generic `CI` flag.

## Player identity and email verification (issue #221)

Better Auth remains the identity source of truth; RuneSpace adds no parallel
account-name table and `player_accounts` gains no name column.

### Player names

Every account has one public **Player name**, stored by Better Auth's official
**Username plugin** (configured in `server/auth-options.ts`, so the generated
`db/auth-schema.ts` and the runtime share it):

- `user.username` — the globally unique comparison key (unique constraint);
- `user.display_username` — the preserved player-facing form;
- `user.name` — kept only because Better Auth requires it; it is set to the
  Player name at sign-up and is never read as public identity.

The rules — 3–20 characters, Unicode letters/marks/numbers plus space `_` `-`
`'` `.`, at least one letter or number, NFKC with invisible characters
stripped and whitespace collapsed, case-insensitive uniqueness, and the
reserved-authority check — live only in `game/domain/player-name.ts`. The
plugin's normalizers and validators call it, and the registration form calls
it for early feedback. Reserved-name matching compares whole words and runs of
adjacent words after folding diacritics, digit look-alikes, and a small table
of Cyrillic/Greek look-alikes; it deliberately never matches a protected term
inside an ordinary word (`ModularMike`, `Staffan`, `Cooperator`).

`server/account-guards.ts` (Better Auth's user-level `before` hook, which runs
ahead of every plugin hook) makes the submitted Player name the single value
for `username`, `displayUsername`, and `name` on `/sign-up/email`, so a crafted
request cannot pair a harmless key with an impersonating display form. It also
refuses any `username`/`displayUsername` change on `/update-user`: Player names
are immutable for ordinary users during alpha. Better Auth 1.6.23's Username
plugin has no immutability option, so this hook is the enforcement.
`/sign-in/username` is disabled; Player names are never a sign-in identifier.

Public owner-name projections (Nearby Players in `server/location-population.ts`
and the character profile in `server/character-profile.ts`) read
`user.display_username`. The DTO field stays `ownerName`.

### Email verification

`emailAndPassword.requireEmailVerification` is on. Sign-up creates the account
without a session and sends one verification link (`sendOnSignUp`). Sign-in by
an unverified account is refused with `EMAIL_NOT_VERIFIED` and **never** sends
mail (`sendOnSignIn: false`); the only other way to get a link is the explicit
resend (`/send-verification-email`). Links use Better Auth's native signed
verification token, expire after Better Auth's default hour, and — through
`autoSignInAfterVerification` — sign the player in and land on `/characters`.
An expired or invalid link lands on `/sign-in?verification=invalid`.

Character reservation requires a verified email, enforced server-side by
`requireVerifiedUser` in `server/ownership.ts`: `createCharacterAction` calls
it independently of `/characters/new`, which also renders a notice instead of
the form for an unverified session.

### Transactional mail

`server/transactional-mail.ts` is the only mail boundary. Its message kinds
are a closed union of account messages (`account-verification`); there is no
marketing, newsletter, or development-update path. ZeptoMail specifics live
only in `server/zeptomail.ts`. Exactly one transport is chosen per
environment — the local-E2E outbox, the in-memory Vitest capture, ZeptoMail
when configured, a console log in development without ZeptoMail, or **none**,
in which case registration is closed rather than degraded.

### Turnstile

Cloudflare Turnstile protects `/sign-up/email` and `/send-verification-email`
through Better Auth's official Captcha plugin, which verifies the
`x-captcha-response` token server-side before any hook runs and fails closed
(500) if its secret is missing or Cloudflare cannot be reached. The site key is
rendered at request time by `/register` and `/sign-in`; the secret never
leaves the server. Development and Vitest fall back to Cloudflare's published
always-pass test keys. Without keys anywhere else, `/register` shows
"registration is temporarily unavailable".

### Abuse limits

`server/account-abuse-policy.ts` (pure) and `server/account-abuse.ts`
(PostgreSQL ledger `account_abuse_events`, one transaction-scoped advisory
lock) enforce:

| Limit | Value |
| --- | --- |
| Sign-up attempts per IP | 5 per 15 min; the window widens to 1 h after 10 attempts and 6 h after 20 attempts in 24 h, then decays |
| Verification resend per address | 1 per 60 s and 5 per 24 h, counted for any requested address so it reveals nothing |
| Verification emails per IP | 20 per hour (refuses sign-up and resend) |
| Global velocity circuit | at 100 verification emails in 10 min, dispatch, sign-up, and resend pause and the server logs `[account-verification] ALERT` |

The IP is Better Auth's resolved client address (`X-Forwarded-For` with one
entry); requests without a resolvable address — or with a multi-entry header —
share one `unknown` bucket, so a proxy that appends hops degrades to a strict
shared limit, not an unlimited one. The per-IP limits therefore assume the
production proxy **replaces** any client-supplied `X-Forwarded-For` with the
real client address (Traefik's default for untrusted sources). If it ever
passed a client's single-value header through unchanged, a client could rotate
its bucket; the per-address resend limits and the global circuit would still
hold. The rollout checklist verifies this, and pinning
`advanced.ipAddress.trustedProxies` is the fix if it does not hold. IP is a
rate-limit signal only, never an identity key. Better Auth's own built-in rate
limiter stays at its defaults.

### Environment variables

| Variable | Scope | Required in production |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | public (rendered into the page) | yes |
| `TURNSTILE_SECRET_KEY` | server-only secret | yes |
| `ZEPTOMAIL_SEND_MAIL_TOKEN` | server-only secret (ZeptoMail Send Mail token) | yes |
| `RUNESPACE_MAIL_FROM_ADDRESS` | server-only (verified ZeptoMail sender, e.g. `accounts@runespace.qcfailed.com`) | yes |
| `RUNESPACE_MAIL_FROM_NAME` | server-only | no (default `RuneSpace`) |
| `ZEPTOMAIL_API_URL` | server-only | only outside ZeptoMail's US data center |

Without the first four, production registration reports unavailable; existing
accounts can still sign in. PR previews need their own values (or remain
closed to registration). Never commit or print any of them.

### Pre-cutover accounts

Accounts created before this change have no Player name. The one-time
`scripts/player-identity-cutover.mjs` (`pnpm --silent run maintenance:issue-221`)
plans every `username IS NULL` account from its existing `user.name`, reports
invalid or colliding names for explicit operator resolution (`--name
<userId>=<Player name>`) instead of inventing replacements, and on execution
sets the Player name and marks the email verified in one serializable
transaction. There is no runtime exception for any account, email, or date.
Retire the script, and add a migration making `username`/`display_username`
`NOT NULL`, once production has been cut over.
