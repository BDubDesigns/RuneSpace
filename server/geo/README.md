# Offline IP-to-country data and classifier

Issue #419 (part of #417). **Nothing here is wired to live analytics yet**:
no route, page, server action, analytics gate or browser bundle imports it, the
consent model is still opt-in worldwide (`ANALYTICS_CONSENT_MODEL`), and
`tests/unit/country-classifier-unwired.test.ts` fails if anything starts
importing it by accident. The slice that wires it deletes that guard on purpose.

## Data: DB-IP Country Lite — October 2026

Data source: [DB-IP Country Lite](https://db-ip.com/db/download/ip-to-country-lite).

The `dbip-country-lite-2026-10.mmdb` database is © DB-IP, licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Attribution required by DB-IP: [IP Geolocation by DB-IP](https://db-ip.com).

Edition: 2026-10. Date: 2026-10-01. Source file:
`https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz`

Verified after extraction against the SHA1 on DB-IP's official page:
`e515b63075ad48847f9c4332b724742e8ba15b0e`.
Expected uncompressed size: 8,348,509 bytes (about 8 MB; 1,383,101 search-tree
nodes, 24-bit records, IPv4 and IPv6). `tests/unit/country-lookup.test.ts`
re-checks both the size and the SHA1 of the committed file.

### Licensing and attribution

- Licence and usage terms were verified against DB-IP's own pages (download
  page, [terms](https://db-ip.com/tos.php) and [FAQ](https://db-ip.com/faq.php))
  and recorded in #417. The free Lite database is CC BY 4.0; DB-IP's FAQ permits
  use in applications, including commercial ones, and redistribution under that
  licence. The redistribution limits on DB-IP's paid databases do not apply.
  The author of this code could not reach `db-ip.com` from the session that
  wrote it, so the reviewer should re-read those three pages before merge.
- DB-IP requires credit with a link to `https://db-ip.com` wherever a web
  application uses its results. **The link must appear in RuneSpace's public
  Safety & Privacy disclosure before the classifier is wired into production.**
  This repository file is not a substitute for that. Nothing is displayed to
  players by this change because nothing uses the data yet.
- The npm package `dbip-city-lite` declares a conflicting licence and is not the
  source of this file. Only the official download above is.

### Why the file is committed, not downloaded at build time

| | Committed (chosen) | Downloaded in the Coolify build |
| --- | --- | --- |
| Build failure modes | None added | DB-IP outage, URL or month rollover, rate limit, checksum drift |
| Reproducibility | A given commit always has the same data | Two builds of one commit can differ |
| Review | One reviewed blob with a recorded SHA1 | Unreviewed remote bytes enter production |
| Cost | About 8 MB in git per refresh (history grows) | Network and time on every build |
| Maintenance | One reviewed PR per refresh | Hidden; a stale cache fails silently |

The committed file ships through both build paths with no extra step: Nixpacks
builds the whole repository, and the in-repo `Dockerfile` copies `server/`.
Memory cost is paid only on first use: about 8 MB resident (the file is read
into one `Buffer`) and a few milliseconds to open, measured on the October file.

## Code

| Piece | Home |
| --- | --- |
| Client address: Better Auth's `getIp` plus a public-address filter | `server/client-ip.ts` |
| MMDB reader (`mmdb-lib`), freshness check, bundled-file loader | `server/geo/country-lookup.ts` |
| Pure country → `us` / `eea` / `uk` / `other` / `unknown` | `features/analytics/analytics-region.ts` |
| Address → country → region, never throws | `server/client-region.ts` |

Design rules, each covered by a test:

- **One address resolver.** `resolveClientIp` calls the same Better Auth `getIp`
  as the sign-up and verification abuse limiter (`ipBucketFor`) and takes the
  same options, so analytics and account protection cannot disagree about the
  visitor. Today that is `X-Forwarded-For` with exactly one valid entry, IPv6
  masked to /64, and `unknown` for a missing, malformed or multi-entry header.
  `CF-IPCountry`, `X-Real-IP`, `Forwarded` and every country-style header are
  ignored, and the country is never read from the request.
- **Unsuitable addresses are unknown.** Malformed input, IPv4 private, loopback,
  link-local, carrier-grade NAT, documentation, benchmarking, multicast and
  reserved ranges, and any IPv6 outside global unicast `2000::/3` (minus
  Teredo/IETF `2001::/23`, documentation `2001:db8::/32` and `3fff::/20`, and
  6to4 `2002::/16`) are rejected before the database is consulted. This
  matters because a request that reaches the app through Docker's IPv6 proxy
  would arrive with a private gateway address, and the development fallback of
  `getIp` is loopback.
- **Every failure is `unknown`.** A missing, corrupt or non-country file, an
  address that is not in the database, a record without a two-letter code, a
  database older than 90 days (or dated in the future), and any thrown error
  all yield no country, and `classifyCountry(null)` is `unknown`. A failed load
  is remembered so a missing file costs one read, not one per request.
- **Regions** are exact: `us` is only `US`; `uk` is only `GB`; `eea` is the 27
  EU states plus Iceland, Liechtenstein and Norway; everything else that is a
  real country (Switzerland, Crown Dependencies, US and other overseas
  territories included) is `other` until it has its own basis. Reserved and
  placeholder codes (`ZZ`, `XK`, `EU`, `UK` and so on) are `unknown`.
  The region is only a label here: it grants no tracking.
- **No address handling.** Nothing logs, caches, persists or returns an address.
  The only output is a two-letter code or a region.

## Verified proxy assumptions

Recorded in #417 from the owner's read-only checks on the Coolify host
(2026-10-27); this change touches none of the infrastructure.

- DNS for `runespace.qcfailed.com` and the preview wildcard is DNS-only in
  Cloudflare, so there is no `CF-IPCountry` and the only client address is the
  one the Coolify proxy (Traefik) adds as `X-Forwarded-For`.
- `coolify-proxy` runs with `--api.insecure=false` and has no `forwardedHeaders`
  or `proxyProtocol` override in the inspected command and compose file. That
  matches Traefik's documented default of not trusting client-supplied
  `X-Forwarded-*` (it replaces them); it is configuration evidence, not a
  direct off-host reproduction.
- App containers publish no host port and nothing listens on host port 3000, so
  there is no direct bypass of the proxy on the application port.
- The hostnames have A records and no AAAA records.
- Production `account_abuse_events` over 25 hours: 12 distinct buckets across 13
  sign-up rows and 11 across 11 verification rows, none `unknown` and none
  private, so the app sees real client addresses.
- A forged `X-Forwarded-For` did not change the rate-limit bucket in a
  controlled sign-in probe run from the VPS itself.

**Still open before any region can open tracking:** the same spoof probe from a
machine off the VPS; confirming nothing else (for example the container
published on 3099, or a future AAAA record) bypasses the proxy; and the legal
and PostHog verification gates in #417. Until then the region is advisory data
that nothing consumes.

## Maintenance

DB-IP publishes a new file around the first of each month. To refresh:

1. Download `dbip-country-lite-YYYY-MM.mmdb.gz` from the official download page
   and verify the SHA1 shown there.
2. Replace the committed `.mmdb` (delete the old one, so there is never more
   than one copy) and update `COUNTRY_DATABASE_FILE`, the edition, size and SHA1
   above, and the size, SHA1 and anchor-address expectations in
   `tests/unit/country-lookup.test.ts`.
3. Run `pnpm test`.

The code treats a database older than 90 days as absent
(`COUNTRY_DATABASE_MAX_AGE_MS`), so a forgotten refresh degrades to `unknown`
(the opt-in path) rather than silently using stale data. A refresh a month is
comfortable; one missed month is tolerated. Before the classifier is wired, a
reminder or alert for an approaching expiry should be added.
