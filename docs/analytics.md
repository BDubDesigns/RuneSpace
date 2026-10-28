# Product analytics (PostHog)

RuneSpace uses **PostHog Cloud (US)** for one narrow job: launch visibility —
where visitors come from, which public pages they open, where they drop out of
registration and character creation, and whether they actually enter and return
to the game. It is deliberately **not** a general game/economy telemetry system
(issue #413). This document is the operational and privacy contract; the
player-facing disclosure is the "Anonymous visit counts", "Product analytics",
"Anonymous and signed-in analytics", and "Your analytics choice, and how long
it's kept" sections of the Safety & Privacy Wiki article
(`features/public-site/public-wiki.ts`), which must stay true to what ships here.

**Two separate things share the consent banner (issue #425).** PostHog is
optional, opt-in, and everything below the "Consent and privacy choices"
heading applies to it only. Alongside it runs a first-party **aggregate
referral counter** (next section) that records anonymous daily page-load
totals, never individuals, and has its own objection control. Declining PostHog
does not turn the counter off, and objecting to the counter does not touch
PostHog. No copy may say "analytics is off" when only one of them is.

## Aggregate referral counts (issue #425)

The owner needs to know which outreach (LinkedIn, Reddit, Discord, Google, …)
brings visitors even when they decline PostHog. That is answered by a daily
total of public page loads filed under sanitized labels, with no individual
data anywhere. **Counts are page loads, not people**: reloads count again,
automated visitors can slip in, browsers without Fetch Metadata are not counted,
and a non-existent path under `/wiki/…` is counted as Wiki. Use them to compare
sources with each other, not as an absolute audience size.

### What is counted, and what is stored

One row per UTC day and label set in `referral_daily_counts`
(`db/site-analytics.ts`, migration `0054_referral_daily_counts`):

| Column | Value |
| --- | --- |
| `day` | UTC date |
| `source_group` | `linkedin`, `reddit`, `discord`, `google`, `bing`, `duckduckgo`, `youtube`, `x`, `facebook`, `bluesky`, `github`, `hacker_news`, `qcfailed`, plus `internal` (own-site referrer), `other` (any unlisted referrer or `utm_source`) and `direct_unknown` (no referrer: typed, bookmarked, or stripped by an app) |
| `utm_source`, `utm_medium`, `utm_campaign` | The existing allowlist sanitizer (`sanitizeUtmValue`: lower-case, ≤ 64 of `a-z 0-9 space _ . -`, anything else dropped whole); `''` when absent |
| `route_category` | `landing`, `updates`, `wiki`, `high-scores`, `auth` (Register, Sign in) |
| `visits` | Number of page loads |

Nothing else is stored: no event rows, IP address, raw `Referer`, full URL or
query, `User-Agent`, device/browser identifier, cookie, account or character ID.
The request's headers are read to decide *whether* to count and *which labels*
to use, then discarded. The label sets per UTC day are capped (100 distinct
non-empty UTM combinations per process per day, `MAX_UTM_COMBINATIONS_PER_DAY`);
the overflow is filed under one `(other)` UTM label so a crafted link cannot grow
the table.

A request is counted only if **all** of these hold (`referralCountLabels` in
`features/analytics/referral-counts.ts`, pure and unit-tested):

- `GET` on exactly `runespace.qcfailed.com` (same forwarded-host rule as the
  server reporter). Previews, `localhost`, CI and every other host are never
  counted. The disposable E2E runtime (CI + plain-HTTP flag + loopback DB, which
  previews and production cannot satisfy) additionally counts the exact host
  `localhost`, so a browser journey can prove the real counter.
- A top-level browser document navigation, by Fetch Metadata
  (`Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`) and `Accept:
  text/html`, and not a `Purpose`/`Sec-Purpose` prefetch or prerender. Browsers
  without Fetch Metadata are undercounted by design.
- A public route: `/`, `/updates…`, `/wiki…`, `/high-scores…`, `/register`,
  `/sign-in`. Never `/play`, `/characters`, `/admin`, `/moderation`,
  `/qc-studio`, `/design-system`, `/api`, `/_next`, assets, or an unknown path.
- Not an obvious crawler, link previewer or automation by `User-Agent`
  (best effort; the string is never stored).
- No **objection**: `Sec-GPC: 1`, `DNT: 1`, the `rs_analytics_signal=1` mirror
  cookie, or the visitor's own `rs_stats_optout=1` cookie.

The **first request can be counted before the visitor can see the control**;
the Safety & Privacy page says so.

### Where it runs, and what was verified

`middleware.ts` (Node.js runtime, `matcher` narrowed to the public routes above)
judges each request and then writes with `event.waitUntil`, so the response is
never delayed or changed. `server/referral-counts.ts` does one
`INSERT … ON CONFLICT DO UPDATE SET visits = visits + 1` per counted load on a
dedicated pool of two connections (never a pool per request), with a statement
timeout, a cap of 200 in-flight writes (excess loads are dropped, not queued
without bound), and a 30-second back-off after any failure, so an unreachable
database costs a few skipped counts and nothing else.

Verified on Next 15.5.20 with a throwaway app and then the real built app
(`next build && next start`), rather than assumed:

- **Middleware and `instrumentation.ts` do not share module state.** Instrumentation,
  middleware and route handlers each got their own instance of a shared module
  (different instance IDs; the counter incremented by middleware read `0` from
  instrumentation and from a route handler). Only `globalThis` was common, which
  is an implementation quirk, not a contract. So there is **no in-memory buffer
  and no instrumentation flusher**: it would silently never flush. The direct
  upsert has nothing to share.
- **Middleware runs for statically generated pages** (`/`, `/wiki/…`,
  `/updates`) as well as 404s and API routes, which no layout, page or route
  handler can see.
- **Next strips its own RSC and prefetch markers before middleware runs**
  (`RSC`, `Next-Router-Prefetch`, `?_rsc=`), so they cannot be used to exclude
  client navigations. Fetch Metadata does it instead: real browsers issue Next's
  client navigations and `<Link>` prefetches as `fetch()` calls
  (`Sec-Fetch-Dest: empty`), proved in a real browser by
  `tests/e2e/visit-counts.spec.ts` (an in-app link click and its prefetches add
  nothing; a reload adds one).
- Concurrency: 300 parallel page loads against the built server produced exactly
  300 counted visits; the integration suite repeats this across two pools. Writes
  to one label row serialize on commit latency (on the order of 100 per second
  on a laptop container), far above expected traffic; past the in-flight cap
  loads are skipped rather than queued, so a surge undercounts instead of
  hurting the site.

### Retention

Rows older than 25 months (`REFERRAL_RETENTION_MONTHS`) are deleted by
``createReferralCounter().prune()`, which each app process runs once per UTC
day, after its first counted load of that day, off the request path. It is
idempotent, so several processes or restarts are harmless. With no traffic there
is nothing new to prune and no schedule to maintain.

### Reading the counts (read-only, owner)

```sql
-- Visits by source and campaign, last 30 days.
select source_group, utm_source, utm_medium, utm_campaign, sum(visits) as page_loads
from referral_daily_counts
where day >= current_date - 30
group by 1, 2, 3, 4
order by page_loads desc;

-- Daily trend for one source.
select day, route_category, visits
from referral_daily_counts
where source_group = 'linkedin' and day >= current_date - 30
order by day, route_category;
```

### Objection control

`rs_stats_optout=1` (first-party, one year, `SameSite=Lax`, `Secure` over HTTPS)
is the visitor's explicit objection; it is a preference record, not tracking. The
"Do not count my visits" control (`features/analytics/VisitCountControl.tsx`, on
Safety & Privacy at `#visit-count-settings`, linked from the banner) is a plain
form that posts to `/api/visit-count-preference`, which sets or clears the cookie
and replies with a small confirmation page, so it works without JavaScript (a
`<noscript>` form offers the undo). With JavaScript it saves in place and
announces the result. The shared cookie string comes from `statsOptOutCookie`.

### Consent banner (issues #413, #425)

`AnalyticsConsentPrompt` is a warm, first-person invitation from the solo
developer ("Help a solo dev make RuneSpace better?"), with two identical
buttons, **Help me improve RuneSpace** and **No thanks**, and a link, **Privacy
& visit-count settings**. It states plainly that daily visit totals are kept
without following individual visitors, that the PostHog choice is optional, free
to refuse and free to change, and that nothing goes to PostHog until the visitor
chooses. It must not guilt, promise an outcome, or imply that consent produces
revenue or family time. The banner only appears where PostHog can run (production
host, token configured); the visit-count control is on Safety & Privacy on every
host.

## Locked decisions

- One PostHog Cloud project for the website and the game. No self-hosting, no
  local analytics database, no internal admin dashboard.
- **Production, plus previews only when deliberately enabled.** Tracking runs
  for the exact host `runespace.qcfailed.com`, and for the exact host
  `pr-<number>.runespace.qcfailed.com` **only if that PR number is listed** in
  the build-time variable `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS` (default: empty,
  so previews send nothing). `localhost`, tests, CI, unlisted previews and every
  other host never send, even if handed the token and a preview list. One free
  PostHog project serves both, so **every event states its `environment`**
  (`production` or `preview`, plus `preview_pr` on a preview), stamped from the
  validated host in code, never from a setting or from incoming data.
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
| Gates, config parsing, consent model, choice/signal cookie names | `features/analytics/analytics-policy.ts` (pure) |
| Event names, route templates, attribution, payload sanitizer, milestone rule | `features/analytics/analytics-events.ts` (pure) |
| `posthog-js` wrapper (lazy import, SDK config, identify/reset, events) | `features/analytics/analytics-client.ts` |
| Pageviews + identity bootstrap (root layout) | `features/analytics/AnalyticsProvider.tsx` |
| `gameplay_entered` + `gameplay_milestone_reached` | `features/analytics/PlayAnalytics.tsx` (mounted by `PlayScreen`) |
| `account_registration_succeeded` | `features/auth/RegisterForm.tsx` |
| `character_creation_succeeded` (server, best-effort) | `server/analytics.ts`, called by `createCharacterAction` |
| One-time consent question | `features/analytics/AnalyticsConsentPrompt.tsx` (mounted by `AnalyticsProvider`, hidden on Play) |
| Aggregate referral counter (rules, persistence, entry point) | `features/analytics/referral-counts.ts` (pure), `server/referral-counts.ts`, `middleware.ts`, table `db/site-analytics.ts` |
| Visit-count objection control + no-JS route | `features/analytics/VisitCountControl.tsx`, `app/api/visit-count-preference/route.ts` |
| Standing choice control | `features/analytics/AnalyticsPrivacyControl.tsx` on `/wiki/safety-and-privacy` |

`posthog-js` is the only added dependency (exact-pinned): it provides identity
persistence, batching, and retries that are not worth hand-rolling. It is
imported lazily, only after every gate passes, so local/CI/preview pages never
download it. There is no `posthog-node`; the one server event is a single POST
to PostHog's public capture endpoint. The PostHog setup wizard was not used.

## Event contract

Every event below, and `$pageview` and `$identify`, also carries `environment`
(`production` | `preview`) and, on a preview, `preview_pr` (the PR number). The
browser stamps them in `before_send` from the live hostname; the server event
stamps them from the request host. See "Environments" below.

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
permitted pageview of a page load also carries the landing attribution: allowlisted
`utm_source`, `utm_medium`, `utm_campaign` (lower-cased, ≤ 64 characters of
`a-z 0-9 space _ . -`; anything else is dropped whole) and `referring_domain`
(domain only, never a path or query). A missing, stripped, or own-site referrer
is reported honestly as `direct_or_unknown`. First-touch copies are registered
once per browser as `first_touch_utm_source`, `first_touch_utm_medium`,
`first_touch_utm_campaign`, and `first_touch_referring_domain`, and ride on every
later event so funnels can break down by acquisition source.

The landing attribution belongs to the *page load*, not to the route the visitor
happens to be on when they accept. It is reduced to the sanitized form above at
initial load and held in memory only (see "Landing attribution before a choice"
below); the first **permitted** pageview of that page load carries it, so a
visitor who browses a few pages and then presses Accept is still attributed to
the link that brought them. Pages browsed before accepting are not replayed.
Later pageviews carry no landing attribution of their own.

PostHog's native source fields are derived from the same sanitized value, on the
landing pageview only. `posthog-js` runs with `save_referrer: false`, because
natively `$referrer` is the **full** referring URL (path and query included), so
the SDK emits no `$referrer` / `$referring_domain` at all. `sanitizeCapture`
therefore sets `$referring_domain` to the referring domain and `$referrer` to
that domain's `https://` origin (never a path, query, or the raw URL, and only
ever an origin because that is all that is known), or `$direct` for both when
there is no external referrer. Any other event reports `$direct`. The custom
`referring_domain` property and the `first_touch_*` copies are unchanged.

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

## Consent and privacy choices

### What PostHog actually stores and sends

With this configuration (`persistence: "localStorage"`, no cookies) `posthog-js`
writes one `localStorage` entry per browser (`ph_<token>_posthog`: a random
anonymous/device ID, session and window IDs, the first-touch attribution
registered by RuneSpace, and, after sign-in, the identified user ID), plus its
own consent flag if opt-in/out is ever called. It then sends events to
`us.i.posthog.com`, which necessarily receives the network address and browser
details of each request. The one server-side event stores nothing on the device.
Reading or writing device storage for analytics, and processing identifiers like
these, is what prior-consent rules (for example the EU ePrivacy rule on
terminal-equipment storage, and the GDPR) generally cover; the strictly
necessary exemption does not obviously fit launch analytics. This is a summary of
behavior, not legal advice, and RuneSpace makes no claim of regulatory compliance.

### Shipped model: consent first (opt-in), for everyone

A visitor's jurisdiction cannot be determined reliably in the browser, so the
smallest solution that satisfies "no collection before required consent where
applicable" without guessing is to require it **everywhere** by default
(`ANALYTICS_CONSENT_MODEL = "opt-in"` in `analytics-policy.ts`):

- On the production host, a visitor with no saved choice and no privacy signal
  sees a one-time prompt with two equal buttons, **Help me improve RuneSpace** (accept) and **No thanks** (decline), not on the Play screen, whose
  footer it would cover). Until they press Accept, **nothing** is loaded,
  stored, or sent: no SDK download, no `localStorage` write, no session
  request, no server-side event.
- The one thing read before a choice is the landing attribution, **in memory
  only** (next subsection). It touches no storage, cookie, SDK or network.
- The choice is the first-party cookie `rs_analytics_choice=on|off` (one year,
  `SameSite=Lax`, `Secure` over HTTPS). It is a record of the preference, not
  analytics. Being a cookie, the server reporter sees it. Safety & Privacy offers
  the same choice at any time; turning analytics off stops the SDK at once
  (`opt_out_capturing` + `reset`) without a reload.
- **Global Privacy Control and Do Not Track always win**, even over a stored
  yes: analytics stays off, and no prompt is shown. The browser's signal is read
  from `navigator.globalPrivacyControl`, `navigator.doNotTrack`, and the legacy
  `window.doNotTrack` / `navigator.msDoNotTrack`. Because request headers can be
  stripped by a proxy, the browser also mirrors the signal into the session
  cookie `rs_analytics_signal=1` on every page load (only where analytics could
  run), and the server-side event refuses on that cookie as well as on
  `Sec-GPC`/`DNT` headers.
- Permission is re-read after the SDK import resolves and immediately before
  every queued event or identity action (and again in the SDK's `before_send`).
  A decline, or a privacy signal appearing, while the SDK is loading therefore
  can never initialise tracking or emit an event; a withdrawn start is not
  cached, so a later Accept still starts cleanly.

### Landing attribution before a choice

On the first sync of a page load (`AnalyticsProvider` mount), when analytics could
run on this host and the visitor has neither declined nor sent a privacy signal,
`syncLandingAttribution()` reduces the landing URL and referrer with the same
allowlist sanitizer as above (UTM trio plus referring domain) and keeps the
result in a module variable. Nothing else about the URL is kept.

- **No persistence, no traffic.** No cookie, `localStorage`/`sessionStorage`,
  IndexedDB, SDK call, or request. A hard page load, reload, or opening the
  site in a new tab starts empty; nothing is rebuilt from storage.
- **Read once.** Only the first call of a page load reads the URL, so route
  changes (`next/link`, `history.pushState`) never replace it with a later URL.
- **Used once.** The first permitted pageview takes it (and registers the
  first-touch copies if the browser has none); it is then gone.
- **Discarded** on Decline, on turning analytics off (`stopAnalytics`), and
  whenever the status is a privacy signal, a prior decline, or a host/config
  where analytics cannot run. A discarded page load is never read again: a visitor
  who declines and later accepts on the same page load is attributed from
  that point, with no landing attribution and no first-touch registration.
- Repeated Accept presses, or a status that stays `permitted`, change nothing:
  the runtime is already mounted, so there is no second pageview or attribution.

### Owner decision: the cost of consent-first

Opt-in will undercount: only visitors who press Accept are measured, so absolute
visitor and funnel numbers are a floor (typically well below true traffic), and
attribution for declined visitors is lost entirely. Alternatives, all one-line
changes to `ANALYTICS_CONSENT_MODEL` or a small follow-up:

1. **Keep opt-in everywhere** (shipped): simplest to defend, lowest numbers.
2. **Opt-out everywhere** (`"opt-out"`): analytics runs until declined, with GPC/DNT
   and the Safety & Privacy control honored. Highest numbers, but collects before
   consent from visitors in regions that require it.
3. **Region-aware**: opt-in only for regions requiring it, which needs a trusted
   country signal (Cloudflare's `CF-IPCountry` does not exist while the site is
   DNS-only; see "Offline country classifier" below) and a decision on the
   default for unknown regions.

Do not ship option 2 or 3 without a deliberate decision, and have counsel confirm
the Safety & Privacy copy for whichever model is chosen.

### Offline country classifier (issue #419, unwired)

Option 3 needs a trusted country. The site is DNS-only in Cloudflare, so there is
no `CF-IPCountry`; the country is instead derived offline from the client address
Better Auth already resolves for the sign-up abuse limiter, using the vendored
DB-IP Country Lite database. This foundation exists but **nothing imports it**:
the consent model is unchanged (opt-in worldwide), no PostHog setting changed, no
endpoint or browser code was added, and a unit test fails if live code starts
using it. Unknown, untrusted, private, malformed, stale-data or failed lookups are
region `unknown`, which must always take the opt-in path. The regions
(`us`, `eea`, `uk`, `other`, `unknown`) are labels only and grant no tracking.

Design, data source and licence, the proxy evidence this relies on, what is still
unverified, and the monthly refresh procedure are in `server/geo/README.md`. DB-IP
requires a public "IP Geolocation by DB-IP" link; it must be added to the Safety &
Privacy disclosure before the classifier is wired into production.

## Configuration

Three **public** values (the token is a client-side, write-only ingestion key,
not a personal/admin API key; do not request or store one). All are read as
`NEXT_PUBLIC_*` and **inlined into the bundles by `next build`**, so they are
**build-time** values.

| Variable | Literal value | Where in Coolify | Build variable | Runtime variable |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` | the project token (US Cloud, project ID 692314; recorded in #413) | Production variables; Preview variables only when testing analytics on a preview | **Yes, required** | Optional (ignored) |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://us.i.posthog.com` | Same as the token | **Yes, required** (the code falls back to this same value when unset) | Optional (ignored) |
| `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS` | the PR number(s) to test, e.g. `414` or `414,420`; **unset/empty everywhere else** | **Preview variables only**, never Production | **Yes** | Optional (ignored) |

Rules:

- Unset, empty, or malformed (token not `phc_…`, host not `https://`, a preview
  list that is not plain comma-separated PR numbers) means analytics is off for
  that part and nothing breaks. A bad preview list is rejected **whole** (for
  example `true`, `414;420`, `*`, `0414`), never partly honored, and it lists at
  most twenty numbers.
- A **rebuild/redeploy** is required for any change: the values are baked into
  the JavaScript bundles and the server build. Changing only a runtime value has
  no effect.
- Never set any of the three for local runs, CI, or E2E. Even if they were set,
  those hosts are not `runespace.qcfailed.com` or a listed preview host, so
  nothing would be sent.
- Docker layer caching: the values are constant, so (unlike a per-commit release
  ID) build variables do not invalidate the cache on every commit.
- No other build or runtime requirement: the app container needs ordinary
  outbound HTTPS to `us.i.posthog.com` for the one server event (failure is
  swallowed); visitors' browsers need to reach it for client events. Ad
  blockers will suppress some client events, so absolute counts are a floor.
  Routing events through a first-party reverse proxy is out of scope.

### Environments (why a shared Coolify variable cannot weaken production)

Coolify gives previews their own **Preview** environment-variable block
(`docs/deployment-database.md`), but a variable may also be shared or inherited
between production and preview, so the code is built to be safe either way:

1. **Production never depends on the preview list.** The production host is
   matched exactly and is always `environment: production`; whether
   `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS` is empty, set, or malformed cannot change
   it. If the list were accidentally set on the production build, it would only
   matter on a preview host, never loosen the production host.
2. **A preview needs its own PR number in the list.** There is no "all previews"
   switch (`*`, `true`, and ranges are rejected). Enabling `414` enables only
   `pr-414.runespace.qcfailed.com`; `pr-415` stays silent.
3. **Strict host validation, shared by browser and server.** Only
   `runespace.qcfailed.com` and `pr-<1–7 digits, no leading zero>.runespace.qcfailed.com`
   can resolve; look-alikes (`….evil.example`, `evil-pr-414…`, userinfo, extra
   labels, paths, other ports' hosts such as `localhost`) resolve to nothing.
4. **The environment label comes from the host, not the config.** A production
   page cannot be labeled `preview` or the reverse, and an incoming
   `environment` property is discarded and recomputed.
5. **Same privacy rules.** A preview asks for the same opt-in consent and honors
   Global Privacy Control / Do Not Track exactly like production. The choice and
   signal cookies are host-scoped, so a preview's choice never carries to
   production or to another PR.
6. **Separate identities.** `localStorage` is per origin, so a preview never
   shares an anonymous ID with production, and preview databases have their own
   user IDs.

Do **not** rely on dashboard filtering as the only safeguard: points 1–6 are
enforced in code and covered by tests; the PostHog filters below are a second
layer.

### Coolify steps (the owner does these; a PR never changes production settings)

Production (once, at launch):

1. RuneSpace application → **Environment Variables** → **Production**.
2. Add `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` (the token) with **Build Variable**
   ticked; add `NEXT_PUBLIC_POSTHOG_HOST` = `https://us.i.posthog.com` with
   **Build Variable** ticked. Do **not** add `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS`.
3. **Redeploy** (a fresh build).

Enable analytics on one preview (for example PR 414):

1. Same page → **Environment Variables** → **Preview Deployments** block. Make
   sure `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` are
   present there too (a preview only builds with what is in its block), each
   with **Build Variable** ticked.
2. Add `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS` = `414` (literal) with **Build
   Variable** ticked.
3. **Redeploy the preview** so it rebuilds (Coolify previews build per PR;
   changing a variable needs a new build of that preview).
4. After testing, **delete** `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS` from the preview
   block (preview traffic otherwise keeps counting against the free allowance)
   and redeploy a preview if you want it silent again. To test a second PR,
   change the value to `414,420`.

Use `https://pr-414.runespace.qcfailed.com/api/build-info` (see
`docs/development-workflow.md`) to confirm the preview is the revision you
expect before testing.

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
5. **Separate production from preview (one project serves both).** Under
   **Project settings → Filter out internal and test users**, add the property
   filter `environment` **equals** `production` (event property), so insights
   with "Filter out internal and test users" on only ever see production. This
   is a second layer; every insight below also carries its own explicit
   `environment = production` filter.
6. **Internal / operator traffic.** The admin allowlist
   (`RUNESPACE_ADMIN_USER_IDS`) is server-only and is never sent to browsers.
   Operators are therefore filtered in PostHog by their stable user IDs:
   **Project settings → Filter out internal and test users** (or **Cohorts →
   New cohort**, "Persons" matching `distinct_id` is one of the operator IDs) and
   use it as an exclusion filter on the insights below. Pre-sign-in operator
   visits are anonymous and cannot be excluded.

## Dashboard recipe

Create a dashboard named **RuneSpace launch**. Give the **dashboard** the global
property filter `environment` = `production`, **and** put the same explicit
`environment = production` event filter on every insight below (a copied or
re-used insight does not inherit a dashboard filter). Also apply the
internal-user filter/cohort exclusion. Use **unique users**, and read counts next
to rates — at launch sample sizes a percentage alone misleads.

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

## Preview events: view and confirm them separately

Preview traffic lands in the same PostHog project, so it is always separated by
two event properties: `environment = preview` and `preview_pr = <number>`.

To confirm a preview reaches PostHog without touching production results:

1. Enable the one preview (see Coolify steps) and redeploy it. Open
   `https://pr-<n>.runespace.qcfailed.com/` in a clean profile (no Global Privacy
   Control), press **Accept** on the prompt, and browse a few pages.
2. PostHog → **Activity → Live events** (or **Events**), add the filters
   `environment` = `preview` and `preview_pr` = `<n>`. Your `$pageview`s appear
   with `$host` = `pr-<n>.runespace.qcfailed.com` and the route templates in
   `$current_url`. Registration, character creation and Play events show the
   same two properties; the server-side `character_creation_succeeded` too.
3. Build a separate dashboard **RuneSpace preview** whose global filter is
   `environment` = `preview` (add `preview_pr` = `<n>` to look at one PR). Never
   mix it with **RuneSpace launch**.
4. Confirm production is untouched: open **RuneSpace launch** and check its
   unique-user and `$pageview` counts are unchanged by your testing, or run an
   ad-hoc Trends insight on `$pageview` with *no* environment filter and a
   breakdown by `environment`: preview traffic appears only under `preview`,
   and the filtered production dashboard excludes it.
5. When finished, remove `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS` from the preview
   variables. Preview events already sent stay in the project until PostHog's
   retention expires, which is harmless because they are always filterable by
   `environment`; they do consume the same free allowance.

## Validating volume and the free tier

- **Live check:** PostHog → **Activity → Live events** (or the *Events* tab):
  confirm only the event names above appear, each with `environment`, route
  templates in `$current_url`, and no `$autocapture`, `$pageleave`, `$snapshot`,
  or `$web_vitals`.
- **Volume:** **Billing → Usage** shows monthly events against the free
  allowance (1 million analytics events per month on the free plan at the time
  of writing; verify at `https://posthog.com/pricing`). Expect roughly one
  event per pageview plus a handful of lifecycle events per player; preview
  testing counts too. Raise it with traffic and keep the billing limit set.

## Manual production smoke check (owner)

1. Set the two production Coolify build variables above (not the preview list)
   and redeploy.
2. Open `https://runespace.qcfailed.com/?utm_source=scapelikes` in a fresh
   browser profile (no extension blockers, no Global Privacy Control). The
   consent prompt appears and **no** PostHog request or `ph_*` `localStorage`
   entry exists yet. Press **Accept**: in PostHog Live events, a `$pageview`
   appears with `route_category: landing`, `utm_source: scapelikes`,
   `$current_url` equal to the bare origin + `/`. Repeat, this time clicking
   through Wiki → Updates *before* pressing Accept: the single `$pageview` is
   for the page you were on and still carries `utm_source: scapelikes`; a
   reload before accepting loses it.
3. Click through Wiki → Safety & Privacy: one `$pageview` per page; the page
   shows "Analytics is on in this browser."
4. Register, verify the email in the same browser, create a character, enter
   Play: `account_registration_succeeded`, an `$identify`, then
   `character_creation_succeeded` and `gameplay_entered` appear, with the player
   identified by the user ID (not an email or name). Mine until XP is gained:
   one `gameplay_milestone_reached`.
5. Sign out; the next pageview has a different distinct ID.
6. Turn analytics off on Safety & Privacy: no further events. Repeat in a
   profile with Global Privacy Control (or Do Not Track) enabled: no prompt, no
   events, and no `character_creation_succeeded` even after Accept was stored.
7. Open a `pr-<n>.runespace.qcfailed.com` preview that is **not** listed in
   `NEXT_PUBLIC_ANALYTICS_PREVIEW_PRS`, and `localhost`: **no** events from
   either. Every production event carries `environment = production` and no
   `preview_pr`.

Do not mark live tracking verified until these are observed in the PostHog
project.

## Testing

Unit tests (stubbed PostHog; CI never contacts it) live in
`tests/unit/analytics-policy.test.ts`, `analytics-events.test.ts`,
`analytics-client.test.ts`, and `analytics-server.test.ts`.
`tests/unit/analytics-attribution-sdk.test.ts` (issue #421) is the exception to
"stubbed": it runs the **real pinned `posthog-js`** with the real
`AnalyticsProvider` and consent prompt in jsdom, stubbing only the network
transport, and asserts on the payloads the SDK actually builds: native referrer
fields, late opt-in after SPA navigation, decline/GPC/DNT, a hard page load,
return visits keeping the original first touch, and malformed UTMs. They cover the
host/config/privacy gates, route templates and attribution sanitizing, payload
allowlisting, event boundaries and the milestone rule, identify/reset, the
disabled paths (localhost, loopback, an unlisted or spoofed preview host, a
malformed preview list), production versus an explicitly enabled preview (with
the PR number), the `environment` stamp on every event type in the browser and
on the server, the consent model and choice/signal cookies, the permission
re-check when the choice changes while the SDK is loading or an action is
queued (deterministic, using a held-open SDK import), and the server reporter's
gates (including a privacy signal that never reaches the request headers) and
failure swallowing.
