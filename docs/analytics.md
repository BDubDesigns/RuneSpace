# Product analytics (PostHog)

RuneSpace uses **PostHog Cloud (US)** for one narrow job: launch visibility —
where visitors come from, which public pages they open, where they drop out of
registration and character creation, and whether they actually enter and return
to the game. It is deliberately **not** a general game/economy telemetry system
(issue #413). This document is the operational and privacy contract; the
player-facing disclosure is the "Product analytics", "Anonymous and signed-in
analytics", and "How long analytics is kept, and your choice" sections of the
Safety & Privacy Wiki article (`features/public-site/public-wiki.ts`), which
must stay true to what ships here.

## Locked decisions

- One PostHog Cloud project for the website and the game. No self-hosting, no
  local analytics database, no internal admin dashboard.
- **Production only.** Tracking runs solely for the exact host
  `runespace.qcfailed.com`. `localhost`, tests, CI, and `pr-*.runespace.qcfailed.com`
  previews send nothing, even if a deployment is handed the public token.
  Missing or malformed configuration is a safe no-op: the build, the pages, and
  every player action behave identically with analytics off.
- **Allowlist, not blocklist.** Only the events below are ever sent. Every SDK
  payload is rebuilt from an allowlist before it leaves the browser.
- The analytics identity is the stable **Better Auth user ID** — never email,
  Player name, or character ID — so switching among an account's three
  characters is still one player.
- Analytics is advisory. It never gates, delays, or alters auth, registration,
  character creation, or gameplay, and server-side reporting happens only after
  the authoritative commit.

## Where it lives

| Piece | Home |
| --- | --- |
| Gates, config parsing, opt-out cookie name | `features/analytics/analytics-policy.ts` (pure) |
| Event names, route templates, attribution, payload sanitizer, milestone rule | `features/analytics/analytics-events.ts` (pure) |
| `posthog-js` wrapper (lazy import, SDK config, identify/reset, events) | `features/analytics/analytics-client.ts` |
| Pageviews + identity bootstrap (root layout) | `features/analytics/AnalyticsProvider.tsx` |
| `gameplay_entered` + `gameplay_milestone_reached` | `features/analytics/PlayAnalytics.tsx` (mounted by `PlayScreen`) |
| `account_registration_succeeded` | `features/auth/RegisterForm.tsx` |
| `character_creation_succeeded` (server, best-effort) | `server/analytics.ts`, called by `createCharacterAction` |
| Opt-out control | `features/analytics/AnalyticsPrivacyControl.tsx` on `/wiki/safety-and-privacy` |

`posthog-js` is the only added dependency (exact-pinned): it provides identity
persistence, batching, and retries that are not worth hand-rolling. It is
imported lazily, only after every gate passes, so local/CI/preview pages never
download it. There is no `posthog-node`; the one server event is a single POST
to PostHog's public capture endpoint. The PostHog setup wizard was not used.

## Event contract

| Event | Fires when | Source |
| --- | --- | --- |
| `$pageview` | A real route change or page load, as a **route template** | browser |
| `account_registration_succeeded` | Better Auth confirms the account was created. Not an email-verification event. Stays anonymous at capture; joined to the account through identify only when the player verifies and signs in **in the same browser** | browser |
| `character_creation_succeeded` | Once per `createCharacter` commit, from `createCharacterAction`. Never on validation errors or refusals. No character ID, name, or portrait | server |
| `gameplay_entered` | `PlayScreen` mounts for a character the server already authorized (verified email, gameplay access, ownership). Once per mount; panels, map/surface changes, polling, and state updates never repeat it. A refused or redirected visit never mounts it | browser |
| `gameplay_milestone_reached` (`milestone: "first_xp_gained"`) | Two consecutive server-confirmed Play states in one session show the character's **total skill XP going from exactly 0 to positive**, at most once per mount. A character that already has XP when Play opens never fires it; ticks and rerenders with no XP change cannot | browser |

Only `milestone` is an allowed custom property, on the milestone event. Nothing
else is attached to any lifecycle event.

### Pageviews and attribution

`$pageview` is sent explicitly (`capture_pageview` is off) when the pathname
changes. The query string is never an input, so `?surface=map` and rerenders do
not repeat it. Dynamic paths become templates, and operator surfaces are not
tracked at all:

`/`, `/updates`, `/updates/[slug]`, `/wiki`, `/wiki/[slug]`, `/wiki/items`,
`/wiki/items/[slug]`, `/high-scores`, `/high-scores/characters/[name]`,
`/register`, `/sign-in`, `/characters`, `/characters/new`,
`/play/[characterId]`, anything else → `/other`. Untracked: `/admin*`,
`/moderation*`, `/qc-studio`, `/design-system`, `/api*`.

Each pageview carries `route_category` (`landing`, `updates`, `wiki`,
`high-scores`, `auth`, `characters`, `play`, `other`) and a rewritten
`$current_url` / `$pathname` / `$host` (origin + template only). The first
pageview of a page load also carries the landing attribution: allowlisted
`utm_source`, `utm_medium`, `utm_campaign` (lower-cased, ≤ 64 characters of
`a-z 0-9 space _ . -`; anything else is dropped whole) and `referring_domain`
(domain only, never a path or query). A missing, stripped, or own-site referrer
is reported honestly as `direct_or_unknown`. First-touch copies are registered
once per browser as `first_touch_utm_source`, `first_touch_utm_medium`,
`first_touch_utm_campaign`, and `first_touch_referring_domain`, and ride on every
later event so funnels can break down by acquisition source.

### What the SDK is told

`posthog-js` is initialised with autocapture, pageview/pageleave capture,
heatmaps, dead clicks, exception capture, performance/web-vitals, rage clicks,
session replay, surveys, product tours, conversations, web experiments, and
external script loading all **explicitly off**, and with `advanced_disable_flags`
so dashboard remote-config can never turn any of them on. `person_profiles` is
`identified_only` (anonymous visitors get no profile), persistence is
`localStorage` (no PostHog cookie), and `respect_dnt` is on. A `before_send`
hook (`sanitizeCapture`) then drops any event outside the allowlist
(`$pageview`, `$identify`, and the four lifecycle events) and rebuilds the rest
from a property allowlist: `$set`, `$set_once` (`$initial_*` URLs),
`$session_entry_*`, `$prev_pageview_*`, raw user agent and every unknown
property are removed, and URL-bearing fields are recomputed from the route
template.

## Identity

- Anonymous until a Better Auth session exists. The runtime then calls
  `posthog.identify(<user.id>)` with **no person properties**.
- On sign-out (or when a session disappears while PostHog still thinks the
  browser is identified) it calls `posthog.reset()`, giving the next visitor a
  fresh anonymous ID.
- Verification auto-sign-in lands on `/characters` as a fresh page load, where
  the session resolves and identifies. The registration event captured before
  that is merged by PostHog through the `$identify` anonymous-ID link.
- The server event uses `distinct_id = user.id`, the same person.
- **Limitation:** registering on one device and verifying on another leaves the
  registration event anonymous and unlinked. Funnels treat that as a drop-off at
  that step; read cross-device conversion with that in mind. Anonymous visits
  before sign-in are never identifiable as internal or as a returning player.

## Privacy choices

Analytics runs unless the visitor opts out; it never runs when:

- the browser sends **Global Privacy Control** (`navigator.globalPrivacyControl`
  / `Sec-GPC: 1`) or **Do Not Track**; or
- the visitor chose "Turn analytics off" on Safety & Privacy, stored as the
  first-party cookie `rs_analytics_optout=1` (one year, `SameSite=Lax`,
  `Secure` over HTTPS). Being a cookie, the server-side character-creation event
  honors it too. Opting out stops the SDK (`opt_out_capturing` + `reset`) at
  once, without a reload; opting back in resumes it.

**Consent is a product/legal decision this PR does not make for the owner.** The
shipped model is *opt-out with automatic honoring of browser privacy signals*.
It does not show a consent banner or block collection for visitors in
jurisdictions that require prior opt-in consent (for example the EU/UK), and the
disclosure makes no regulatory-compliance claim. If the owner decides prior
consent is required for some regions, the smallest follow-up is to make
`analyticsStatus()` / `serverAnalyticsAllowed()` also require a stored opt-in
for those visitors; the single gate in `analytics-policy.ts` is the place to add
it.

## Configuration

Two **public, write-only** values. The token is a client-side ingestion key, not
a personal/admin API key; do not request or store one. Both are read as
`NEXT_PUBLIC_*` and **inlined into the bundles by `next build`**, so they are
**build-time** values.

| Variable | Value for production | Build variable | Runtime variable |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | the project token from the PostHog project (US Cloud, project ID 692314) | **Yes — required** | Optional (ignored; harmless) |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` | **Yes — required** (the code falls back to this same value when unset) | Optional (ignored; harmless) |

The project token is also recorded in issue #413. Rules:

- Unset, empty, or malformed (token not `phc_…`, host not `https://`) means
  analytics is off and nothing breaks.
- A **rebuild/redeploy** is required for any change: the values are baked into
  the JavaScript bundles and the server build. Changing only a runtime value has
  no effect.
- Coolify PR previews inherit the application's environment variables. That is
  safe — the hostname gate keeps previews silent — but if you prefer defense in
  depth, leave preview-specific values unset. Never set the token for local,
  CI, or E2E runs.
- Docker layer caching: the token is constant, so (unlike a per-commit release
  ID) a build variable does not invalidate the cache on every commit.
- No other build or runtime requirement: the app container needs ordinary
  outbound HTTPS to `us.i.posthog.com` for the one server event (failure is
  swallowed); visitors' browsers need to reach it for client events. Ad
  blockers will suppress some client events, so absolute counts are a floor.
  Routing events through a first-party reverse proxy is out of scope.

Coolify steps (do not change production settings from a PR; the owner does this
at deploy time):

1. RuneSpace application → **Environment Variables**.
2. Add `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` with the token; keep **Build
   Variable** ticked (runtime may stay on or be switched off).
3. Add `NEXT_PUBLIC_POSTHOG_HOST` = `https://us.i.posthog.com`; keep **Build
   Variable** ticked.
4. **Redeploy** (a fresh build).

## PostHog project setup

Done once in the PostHog project (`https://us.posthog.com`). None of it is
needed for ingestion; the app already disables these features in code.

1. **Project settings → Product analytics:** Autocapture **off**; Heatmaps
   **off**; Web vitals autocapture **off**.
2. **Project settings → Session replay:** **off**.
3. **Project settings → Web analytics / Data:** turn **Discard client IP data**
   **on**. Browsers must contact PostHog, so IP addresses reach it
   unless discarded; this setting stops them being stored on events.
4. **Project settings → Data management / Billing:** confirm the plan's event
   retention (the Safety & Privacy copy says "up to one year", which is the
   free plan; update it if the plan changes) and set a **billing limit** on
   product analytics so volume can never become an unexpected charge.
5. **Internal / operator traffic.** The admin allowlist
   (`RUNESPACE_ADMIN_USER_IDS`) is server-only and is never sent to browsers.
   Operators are therefore filtered in PostHog by their stable user IDs:
   **Project settings → Filter out internal and test users** (or **Cohorts →
   New cohort**, "Persons" matching `distinct_id` is one of the operator IDs) and
   use it as an exclusion filter on the insights below. Pre-sign-in operator
   visits are anonymous and cannot be excluded.

## Dashboard recipe

Create a dashboard named **RuneSpace launch**. Apply the internal-user
filter/cohort exclusion to every insight below. Use **unique users**, and read
counts next to rates — at launch sample sizes a percentage alone misleads.

**Acquisition**

1. *Visitors and pageviews by day* — Trends: `$pageview`, series 1 "Unique
   users", series 2 "Total count", interval Day.
2. *First-touch referrer* — Trends: `$pageview` unique users, breakdown by event
   property `first_touch_referring_domain`; table view. The value
   `direct_or_unknown` is direct traffic and stripped referrers; keep it as its
   own row so attributed and unattributed traffic are not blended.
3. *Campaigns* — same insight, breakdown by `first_touch_utm_source` (then
   `first_touch_utm_medium`, `first_touch_utm_campaign`). A link like
   `https://runespace.qcfailed.com/?utm_source=scapelikes` appears as
   `scapelikes`.
4. *Popular public routes* — Trends: `$pageview` unique users, breakdown by
   `$pathname`; or by `route_category` for a coarse view.

**Activation funnel** — Funnels, unique users, conversion window 14 days, steps:

1. `$pageview` (any visit)
2. `$pageview` where `$pathname` = `/register`
3. `account_registration_succeeded`
4. `character_creation_succeeded`
5. `gameplay_entered`
6. `gameplay_milestone_reached`

Show both the counts and the conversion/drop-off, with the breakdown
`first_touch_utm_source` (and a second copy broken down by
`first_touch_referring_domain`). Cross-device registration → verification drops
out at step 4 by design (see Identity).

**Retention**

1. *Daily entering accounts* — Trends: `gameplay_entered`, unique users, Day.
2. *D1 / D7 returning players* — Retention: target and returning event both
   `gameplay_entered`, period Day, 8 intervals, cohort size shown beside rates.
   Each day is a separate calendar-day `gameplay_entered`, so open tabs, the
   online count, and presence heartbeats never count as retention.
3. *Returning website visitors* (kept separate from players) — Retention on
   `$pageview` the same way.

## Validating volume and the free tier

- **Live check:** PostHog → **Activity → Live events** (or the *Events* tab):
  confirm only the event names above appear, with route templates in
  `$current_url` and no `$autocapture`, `$pageleave`, `$snapshot`, or
  `$web_vitals`.
- **Volume:** **Billing → Usage** shows monthly events against the free
  allowance (1 million analytics events per month on the free plan at the time
  of writing; verify at `https://posthog.com/pricing`). Expect roughly one
  event per pageview plus a handful of lifecycle events per player; raise it with
  traffic and keep the billing limit set.

## Manual production smoke check (owner)

1. Set the two Coolify build variables above and redeploy.
2. Open `https://runespace.qcfailed.com/?utm_source=scapelikes` in a fresh
   browser profile (no extension blockers, no Global Privacy Control). In
   PostHog Live events, a `$pageview` appears with `route_category: landing`,
   `utm_source: scapelikes`, `$current_url` equal to the bare origin + `/`.
3. Click through Wiki → Safety & Privacy: one `$pageview` per page; the page
   shows "Analytics is on in this browser."
4. Register, verify the email in the same browser, create a character, enter
   Play: `account_registration_succeeded`, an `$identify`, then
   `character_creation_succeeded` and `gameplay_entered` appear, with the player
   identified by the user ID (not an email or name). Mine until XP is gained:
   one `gameplay_milestone_reached`.
5. Sign out; the next pageview has a different distinct ID.
6. Turn analytics off on Safety & Privacy: no further events.
7. Open a `pr-<n>.runespace.qcfailed.com` preview and `localhost`: **no** events
   from either.

Do not mark live tracking verified until these are observed in the PostHog
project.

## Testing

Unit tests (stubbed PostHog; CI never contacts it) live in
`tests/unit/analytics-policy.test.ts`, `analytics-events.test.ts`,
`analytics-client.test.ts`, and `analytics-server.test.ts`. They cover the
host/config/privacy gates, route templates and attribution sanitizing, payload
allowlisting, event boundaries and the milestone rule, identify/reset, the
disabled paths, and the server reporter's gates and failure swallowing.
