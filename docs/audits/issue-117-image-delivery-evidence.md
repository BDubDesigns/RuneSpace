# Issue #117 — Image delivery evidence report

Durable evidence record for Issue #117 ("Investigate and improve slow image
loading / progressive image delivery"). It follows the repository debugging
rule — **observe → verify → reproduce → isolate → fix** — and separates
measured facts, tested-and-rejected hypotheses, isolated causes, the implemented
change, and remaining recommendations.

Nothing in the delivery path was changed until the unchanged deployed behaviour
had been reproduced and the dominant cause isolated.

## 1. Measurement environment

| Item | Value |
| --- | --- |
| Deployed production target | `https://runespace.qcfailed.com` (read-only) |
| Production revision measured | `GET /api/build-info` → `4e5d7278832c495a587258825b8de960cbf025f3` |
| Deployed preview target | `https://pr-188.runespace.qcfailed.com` |
| Preview revision for "before" | `02fff36098cb6dfaea127369768f1583b2cd8456` (main + one docs file; no behaviour change) |
| Measuring host | Hermes Oracle VPS (ARM64, Debian 13), unrestricted outbound HTTPS |
| Tools | `curl` (`-w` timing), Playwright 1.51.1 driving Chromium 1234, Chrome DevTools Protocol `Network.emulateNetworkConditions` |
| Canonical mobile profile | 390 × 844 CSS px, `devicePixelRatio` 3, mobile UA, touch |
| Desktop profile | 1440 × 900 CSS px, `devicePixelRatio` 2 |
| Emulated mobile network (where stated) | 150 ms RTT, 4 Mbit/s down |

**Read-only discipline.** Every production interaction was a `GET` for HTML or
an image. No production account, character, database row, Coolify setting,
container, or proxy configuration was created or modified. The one authenticated
environment used was the **PR preview**, with a disposable
`review-20260913-i117…` account per `docs/development-workflow.md` →
"Preview test-data discipline". Preview/production database isolation was
verified: the review credentials return `401` at
`runespace.qcfailed.com/api/auth/sign-in/email` and `200` at
`pr-188.runespace.qcfailed.com`.

**Distance caveat (unchanged from the issue).** A VPS near the deployment has a
much shorter RTT than a player's phone — the TLS handshake floor measured here
is ~0.32 s, of which ~0.15 s is RTT. Byte counts, delivered formats, requested
candidate widths, cache headers, cold/warm classification and *relative*
scheduling gaps transfer directly to a phone. Absolute wall-clock does not.
Final acceptance still needs a real phone.

## 2. Measured facts — asset inventory

Intrinsic dimensions and byte sizes were read from the committed files
(PNG/WebP headers), not from metadata.

| Class | Representative repository file | Intrinsic | Format | Source bytes | Rendered (390 px, DPR 3) | Delivery path |
| --- | --- | --- | --- | ---: | --- | --- |
| World Location scene | `public/location-scenes/crash-site.webp` | 1920×480 | lossy WebP | 101,390 | 364×126 CSS (1092×378 device) | `next/image` |
| World Location scene | `public/location-scenes/the-jag.png` | **2508×627** | PNG | 2,586,798 | same | `next/image` |
| World Location scene | `public/location-scenes/the-long-scramble.png` | **2508×627** | PNG | 2,871,704 | same | `next/image` |
| World Location scene | `public/location-scenes/holo-hollow.webp` | 1536×384 | lossy WebP | 96,144 | same | `next/image` |
| Local Place scene | `public/location-scenes/holo-hollow-souvenirs-exterior.webp` | 1536×384 | lossy WebP | 151,184 | hero: 364×126; directory card: 364×72 | `next/image` |
| Dialogue background | `public/location-scenes/hh-bnb-interior.webp` | 1536×864 | lossy WebP | 173,038 | 314×224 CSS | `next/image` (`priority`) |
| NPC portrait | `public/npc-art/wade-concerned.png` | 1086×1448 | PNG | 2,495,668 | 155×206 CSS | `next/image` |
| NPC portrait (set of 15) | `public/npc-art/*.png` | ~1086–1122 × ~1402–1450 | PNG | 2.24–2.59 MB each, **35 MB total** | as above | `next/image` |
| Character portrait | `public/character-portraits/portrait-baker-01.webp` | 512×512 | lossy WebP | 51,288 | 80×80 / 112×112 CSS | `next/image` |
| Item art | `public/item-art/power-cell.png` | 1286×1247 | PNG | 2,542,601 | 80×80 CSS tile; ~273 CSS px dialogue reveal | `next/image` |
| Item art | `public/item-art/ferrite-shale.webp` | 512×512 | lossy WebP | 45,556 | 80×80 CSS | `next/image` |
| Map identifier | `public/map-icons/the-long-scramble.png` | 1254×1254 | PNG | **651,008** | ~101×95 CSS inside a ~140 px hex | **raw static** — SVG `<image href>` |
| Map identifier | `public/map-icons/the-jag.png` | 1254×1254 | PNG | **408,929** | as above | **raw static** |
| Map identifier | `public/map-icons/crash-site.webp` | 512×421 | lossless WebP | 113,128 | as above | **raw static** |
| Brand lockup | `public/branding/runespace-header-lockup.png` | 1455×376 | PNG | 935,524 | 162×42 CSS (authenticated header) | `next/image` (`priority`) |
| Brand emblem | `public/branding/runespace-emblem.png` | 1292×1340 | PNG | 3,183,923 | 0×0 at ≥390 px (hidden) | `next/image` |
| Public landing screenshot | `public/landing/location-crash-site.webp` | 892×572 | lossy WebP | 32,002 | 356×228 CSS | `next/image` |
| Update hero | `public/updates/holo-hollow-town.webp` | 1536×384 | lossy WebP | 96,144 | full-width card | `next/image` |

Two facts from this table matter on their own:

- **Every map identifier bypasses `next/image`.** `features/travel/LocalMapPanel.tsx`
  paints them as SVG `<image href={…}>` inside the hex chassis, so the raw
  committed file is sent verbatim.
- **`game/content/locations.ts` records the wrong intrinsic size for two scenes.**
  The Jag and The Long Scramble are declared `width: 1920, height: 480`; the
  committed files are 2508×627. The aspect ratio is identical (4:1), so there is
  no layout shift and `tests/unit/location-scene.test.ts`'s ratio assertion
  passes — but `docs/art-cookbook.md` requires metadata to describe the actual
  file.

## 3. Measured facts — what the deployed server actually returns

### 3.1 Optimization is enabled and working

`/_next/image` returns `image/webp` derivatives for both PNG and WebP sources,
at the requested candidate width, with `x-nextjs-cache` present. Verified
read-only against production; `sharp@0.34.5` is an `optionalDependency` of
`next@15.5.20` and is present in `pnpm-lock.yaml`, and the installed tree links
it under Next rather than hoisting it to the root. No evidence of a missing or
degraded transformer was found. Next's configured `formats` default is
`['image/webp']`, so WebP — not AVIF — is what a modern browser negotiates here.

### 3.2 Representative deployed responses (production, VPS, `curl`)

| Request | Delivered | Bytes | `x-nextjs-cache` | TTFB | Total | `Cache-Control` |
| --- | --- | ---: | --- | ---: | ---: | --- |
| `/location-scenes/the-jag.png` (static) | image/png | 2,586,798 | – | 0.474 s | 2.28 s | `public, max-age=0` |
| `/_next/image?…the-jag.png&w=640&q=75` | image/webp | 17,714 | MISS | 0.565 s | 0.712 s | `public, max-age=60, must-revalidate` |
| `…&w=828` | image/webp | 28,616 | MISS | 0.551 s | 0.701 s | same |
| `…&w=1080` | image/webp | 46,626 | STALE | 0.470 s | 0.763 s | same |
| `…&w=1200` (cold) | image/webp | 57,116 | MISS | 0.645 s | 0.959 s | same |
| `…&w=1200` (immediate repeats ×3) | image/webp | 57,116 | HIT | 0.476–0.489 s | 0.778–0.799 s | same |
| `…&w=1920` | image/webp | 127,152 | MISS | 0.696 s | 1.142 s | same |
| `/_next/image?…crash-site.webp&w=1200&q=75` | image/webp | 32,302 | STALE | 0.476 s | 0.626 s | same |
| `/_next/image?…the-long-scramble.png&w=1200&q=75` | image/webp | 71,050 | MISS | 0.615 s | 0.912 s | same |
| `/_next/image?…holo-hollow.webp&w=1200&q=75` | image/webp | 43,922 | MISS | 0.622 s | 0.816 s | same |
| `/_next/image?…power-cell.png&w=256&q=75` | image/webp | 33,478 | STALE | 0.521 s | 0.673 s | same |
| `/_next/image?…power-cell.png&w=828&q=75` | image/webp | **325,412** | STALE | 0.505 s | 1.378 s | same |
| `/_next/image?…portrait-baker-01.webp&w=256&q=75` | image/webp | 12,346 | MISS | 0.528 s | 0.625 s | same |
| `/map-icons/the-long-scramble.png` (static) | image/png | **651,008** | – | 0.474 s | 2.104 s | `public, max-age=0` |
| `/map-icons/the-jag.png` (static) | image/png | **408,929** | – | 0.479 s | 1.527 s | `public, max-age=0` |
| `/map-icons/crash-site.webp` (static) | image/webp | 113,128 | – | 0.475 s | 0.929 s | `public, max-age=0` |
| `/branding/runespace-emblem.png` (static) | image/png | 3,183,923 | – | 0.475 s | 3.052 s | `public, max-age=0` |

Connection floor for every row: `time_connect` ≈ 0.15 s, `time_appconnect`
(TLS) ≈ 0.32 s. An optimizer **HIT** therefore adds essentially no server time;
a **MISS** on a 2.5 MB PNG source adds roughly 0.15–0.23 s of transform.

### 3.3 Cache semantics, verified rather than assumed

- `/public` static assets are served by Next with `cache-control: public, max-age=0`
  plus `ETag`/`Last-Modified`. Every repeat view revalidates.
- `/_next/image` responses are served with `cache-control: public, max-age=60, must-revalidate`.
  This is Next's own arithmetic, not a proxy rewrite: `dist/server/image-optimizer.js`
  computes `maxAge = Math.max(images.minimumCacheTTL, getMaxAge(upstreamCacheControl))`
  and emits `public, max-age=${maxAge}, must-revalidate`. `minimumCacheTTL`
  defaults to `60`, the upstream `/public` asset says `max-age=0`, and
  `next.config.ts` has no `images` block — so **60 seconds** is the ceiling for
  every optimized gameplay image in both the browser and the on-disk optimizer
  cache.
- The reverse proxy does **not** alter caching semantics: Next's
  `cache-control`, `etag`, `vary: Accept` and `x-nextjs-cache` all arrive
  unmodified, and no CDN cache headers are present. `alt-svc: h3` is the only
  proxy-added header observed.
- The optimizer cache lives in `.next/cache/images` inside the container, so it
  does not survive container replacement. With a 60 s TTL that matters far less
  than it would with a long TTL.
- `_next/static` chunk URLs carry `?dpl=<release>`; `/_next/image` URLs do
  **not**. Any future long image TTL would therefore not be busted by a deploy.

### 3.4 Cold vs warm, measured in a real browser

Production `/qc-studio` at 390 × 844 DPR 3, one browser context, four sequential
visits:

| Step | Scene background | NPC portrait | Result |
| --- | --- | --- | --- |
| 1. Cold (fresh context) | 200, 32,327 B, 319 ms | 200, 80,112 B, 424 ms | full download |
| 2. Return within 60 s | `transferSize` 0, 0 ms | `transferSize` 0, 0 ms | browser cache hit, **no request** |
| 3. Return after 75 s | HTTP **304**, 300 B, 163 ms | HTTP **304**, 300 B, 158 ms | conditional revalidation, **no body re-sent** |
| 4. Immediate repeat | `transferSize` 0, 0 ms | `transferSize` 0, 0 ms | cache hit again |

So a repeat view more than a minute later costs **one conditional round trip per
image**, not a re-download.

## 4. Measured facts — canonical ~390 px mobile behaviour

### 4.1 What the browser actually requests

`img.currentSrc` and Resource Timing, captured in Chromium at 390 × 844 DPR 3.
(`naturalWidth` is reported density-corrected for `w`-descriptor srcsets, so the
delivered pixel width is the `w` parameter, capped at the source width.)

| Surface / asset | `sizes` | Rendered CSS | DPR-3 useful px | Requested candidate | Delivered | Bytes |
| --- | --- | --- | ---: | --- | --- | ---: |
| Play Location hero (`crash-site.webp`) | `(max-width:640px) 100vw, (max-width:1024px) 92vw, 890px` | 364×126 | 1092 wide | `w=1200&q=75` | WebP 1200×300 | 32,302 |
| Dialogue background (`crash-site.webp`) | `(max-width:640px) 100vw, 56rem` | 314×224 | 942 wide | `w=1200&q=75` | WebP 1200×300 | 32,327 |
| NPC portrait (`wade-concerned.png`) | `min(60vw, 24rem)` | 155×206 | 465 wide | `w=750&q=75` | WebP 750×1000 | 80,112 |
| Character portrait (profile) | `80px` … `384px` variants | 80×80 / 128×128 | 240–384 | `w=384&q=75` | WebP | ~12 k |
| Header lockup | `192px` (game) / `(max-width:640px) 46vw, 208px` (public) | 162×42 / 155×40 | ~486 | `w=640&q=75` | WebP 640×165 | 32,334 |
| Public emblem (hidden ≥390 px) | `40px` | **0×0** | – | `w=128&q=75` | WebP | 9,243 |
| Landing screenshots | `(max-width:1024px) 100vw, 1152px` | 356×228 | 1068 | `w=1200&q=75` | WebP 892 px (source cap) | 26,167 |

Desktop control at 1440 × 900 DPR 2: the dialogue background resolves to
`w=1920` (86,892 B) and the NPC portrait to `w=828` (93,518 B) — candidate
selection is sane at both widths, so the `sizes` contracts are not producing
wildly oversized requests at either end.

### 4.2 Whole-surface byte totals (authenticated Play, 390 px DPR 3)

Captured at the network layer so SVG-referenced images are included:

| Surface | Image requests | Total image bytes |
| --- | ---: | ---: |
| Location (Crash Site) | 3 | **64,636** |
| Map (`?surface=map`) | 8 | **1,544,805** |

The Location surface is *light*. The Map surface ships 1.51 MB of raw map
identifiers — 24× the Location surface — for six hexes drawn at ~140 CSS px.

## 5. Measured facts — request scheduling

`features/location-scene/LocationSceneHeader.tsx` passed `priority={false}`, so
`next/image` authored the hero as `loading="lazy"` with no `<link rel=preload>`.
`features/dialogue/DialogueScene.tsx` gave `priority` to the dialogue
*background* but not to the NPC portrait composited on top of it. Meanwhile
`components/branding/RuneSpaceBrand.tsx` defaults to `priority`, so on every
authenticated page the only preloaded image was the ~162×42 brand lockup.

Both scheduling gaps were reproduced before anything was changed:

**Deployed** — `pr-188` `/qc-studio`, 390 × 844 DPR 3, 150 ms / 4 Mbit/s,
5 cold contexts, medians (HTML `responseEnd` 625 ms, LCP 1052 ms):

| Image | Authored | Request start | Response end |
| --- | --- | ---: | ---: |
| Dialogue background | `priority` → preloaded | 529 ms | 953 ms |
| NPC portrait (the subject) | `loading="lazy"` | **997 ms** | **1370 ms** |

The portrait's request began **468 ms after** the background's, although both
were in the same server-rendered HTML and both were inside the initial viewport.

**Production, unthrottled** — `/qc-studio` 390 px DPR 3: background start 525 ms
vs portrait start 742 ms. Landing page: eager header images start 511–526 ms vs
lazy content images 739–1151 ms. The same ordering appears every time.

**Local production build** (`next build` + `next start`, Node 22, disposable
`issue-117` database, port 3320), 390 × 844 DPR 3, 150 ms / 4 Mbit/s, 5 cold
contexts, medians — the authenticated Location surface:

| Image | Authored | Request start | Response end |
| --- | --- | ---: | ---: |
| Brand lockup | `priority` → preloaded | 190 ms | 547 ms |
| **Location hero scene** (LCP element) | `loading="lazy"` | **459 ms** | **931 ms** |

LCP median 976 ms, and the LCP element was confirmed to be
`/_next/image?url=/location-scenes/crash-site.webp&w=1200&q=75`.

Offscreen artwork was checked for the opposite failure and is correct: the other
locations' scenes are not fetched on the current page, and the Local Place
directory thumbnails are lazy.

## 6. Hypotheses tested and rejected

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| "`next/image` is not actually optimizing in the self-hosted container" | **Rejected** | `/_next/image` returns `image/webp` at the requested width from PNG and WebP sources, with `x-nextjs-cache` and `vary: Accept`. |
| "The source images are simply too large" (for the scene class) | **Rejected as the cause of scene slowness** | The scene derivative a phone actually receives is 32–71 KB. The multi-megabyte originals are never requested by the application. It **is** true for the map identifiers, which bypass the optimizer (§7.2). |
| "The `sizes` contracts are wrong and the browser downloads an oversized candidate" | **Rejected** | At 390 px DPR 3 the hero resolves to `w=1200` for 1092 device px of layout; the portrait to `w=750` for 465 device px; desktop resolves to `w=1920`/`w=828`. Nothing is grossly oversized. |
| "A reverse proxy or CDN is breaking caching" | **Rejected** | Next's own `cache-control`, `etag`, `vary` and `x-nextjs-cache` arrive unmodified; no CDN headers; the 60 s TTL is computed by Next itself. |
| "Repeat views re-download every image" | **Rejected** | After the TTL expires the browser sends a conditional request and receives `304` with no body (§3.4). |
| "Application/optimizer TTFB dominates" | **Rejected as dominant** | An optimizer HIT's TTFB sits at the TLS+RTT floor; a cold MISS on a 2.5 MB PNG adds only ~0.15–0.23 s. |
| "Deployment/container replacement destroys a valuable optimized-image cache" | **Rejected as significant today** | True mechanically (the cache is in `.next/cache/images`), but with a 60 s TTL there is no long-lived cache to lose. It would become significant if the TTL were raised. |
| "The scene renders only after hydration, so its request starts late for that reason" | **Rejected** | `app/play/[characterId]/page.tsx` server-renders `PlayScreen` with authoritative state; the hero `<img>` is in the initial HTML. The delay is lazy-loading discovery, not client-side rendering. |

## 7. Isolated causes

### 7.1 Primary — the visible gameplay artwork was not prioritized

The largest, most-visible artwork on each surface (the Location / Local Place
hero scene, and the speaking NPC portrait) was the *only* artwork on that
surface authored without `priority`, while smaller or purely supporting images
(the brand lockup, the dialogue background behind the portrait) were preloaded.
The browser therefore could not discover the hero until after layout. Measured
penalty: **269 ms later request start / 311 ms later completion** for the
Location hero (local, throttled), and **468 ms later request start** for the NPC
portrait (deployed, throttled). This is the cause that matches the reported
symptom — artwork that arrives noticeably after the rest of the screen, on every
cold view, even though the bytes themselves are small.

### 7.2 Secondary — the Map surface ships 1.51 MB of unoptimized identifiers

`features/travel/LocalMapPanel.tsx` renders map identifiers as SVG
`<image href>`, which cannot pass through `next/image`. The committed files are
therefore delivered verbatim: 651,008 B and 408,929 B for the two legacy PNG
identifiers, plus four lossless WebPs of 96–121 KB, for hexes drawn at ~140 CSS
px. `docs/art-cookbook.md` already records `the-jag.png` and
`the-long-scramble.png` as legacy files that predate the map-identifier pipeline
and remain "follow-up optimization/art debt". This measurement quantifies that
debt; it is an art-contract change and is **not** made here.

### 7.3 Secondary — 60-second cache ceiling on every optimized image

Because `/public` upstreams advertise `max-age=0` and `images.minimumCacheTTL`
is unset, every optimized gameplay image expires from the browser cache after
60 s and is then revalidated with `must-revalidate`. The bytes are not re-sent
(`304`), but each image costs one conditional round trip on every navigation
more than a minute after the last one — which is most navigations during real
play. Raising the TTL is a genuine improvement but carries a real tradeoff (see
§9), so it is a recommendation, not part of this change.

### 7.4 Tertiary observations

- `game/content/locations.ts` declares The Jag and The Long Scramble as
  1920×480 while the committed files are 2508×627 (§2).
- The dialogue item reveal requests `w=828` of `power-cell.png` → **325,412 B**,
  the largest single optimized response measured anywhere in the game.
- `components/public-site/PublicSiteShell.tsx` fetches the emblem derivative
  (9,243 B) at viewports ≥390 px where CSS has hidden it (`0×0`). Public-site
  only.
- The public landing screenshots are 892 px sources rendered at up to 1102 CSS
  px on a DPR-2 desktop, so they are delivered soft there.

## 8. Implemented change and before/after evidence

**Implemented — exactly one correction, the smallest maintainable response to
§7.1:** give the currently-visible primary artwork real loading priority.

- `features/location-scene/LocationSceneHeader.tsx`: `priority={false}` → `priority`.
- `features/dialogue/DialogueScene.tsx`: the NPC portrait gains `priority`.
- `tests/unit/location-scene.test.ts`: a structural guard asserting the hero is
  a priority image, that the header contains exactly one `<Image>` (so exactly
  one preload), and that `LocalPlaceDirectory` thumbnails stay lazy.

Exactly one scene renders per surface and one portrait per dialogue beat, so
this adds one preload each rather than making a page of artwork eager. No image
bytes, codec, source master, `sizes` contract, Next configuration,
Docker/Coolify configuration, or cache behaviour was touched.

### 8.1 Before/after — authenticated Location surface

Local production build, 390 × 844 DPR 3, 150 ms / 4 Mbit/s, 5 cold contexts,
medians. Same build pipeline, same database, same host, same throttling.

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| HTML `responseEnd` | 174 ms | 174 ms | – |
| Hero scene request start | 459 ms | **195 ms** | **−264 ms** |
| Hero scene response end | 931 ms | **620 ms** | **−311 ms** |
| **Largest Contentful Paint** | 976 ms | **668 ms** | **−308 ms (−32 %)** |
| Hero `loading` attribute | `lazy` | *(none — eager)* | |
| `<link rel=preload as=image>` count | 1 (brand lockup) | 2 (lockup + hero scene) | |
| Hero delivered bytes | 32,302 | 32,302 | unchanged |
| Location-surface image bytes | 64,636 | 64,636 | unchanged |

### 8.2 Before/after — deployed dialogue artwork

Measured **deployed**, on the same host and proxy, by interleaving production
(unchanged `4e5d727`) and the `pr-188` preview (this branch, `8d81563`) run by
run: `/qc-studio` renders the production `DialogueScene` with the real
conversation background and NPC expression. 390 × 844 DPR 3, 150 ms / 4 Mbit/s,
9 cold contexts each, medians.

| Metric | Before (production) | After (preview) | Δ |
| --- | ---: | ---: | ---: |
| HTML `responseEnd` | 625 ms | 619 ms | – |
| NPC portrait `loading` attribute | `lazy` | *(none — eager)* | |
| Background request start | 523 ms | 535 ms | +12 ms |
| Background response end | 940 ms | **893 ms** | −47 ms |
| NPC portrait request start | 985 ms | **537 ms** | **−448 ms** |
| NPC portrait response end | 1378 ms | **1157 ms** | **−221 ms** |
| **Whole dialogue frame complete** | 1378 ms | **1186 ms** | **−192 ms** |
| Delivered bytes (background / portrait) | 32,327 / 80,112 | 32,327 / 80,112 | unchanged |

The portrait now starts with the background instead of nearly half a second
later, and the complete frame — the thing a player actually waits for — lands
192 ms sooner without the background regressing.

**One honest counter-observation.** On `/qc-studio` the LCP element is the
authoring page's `<h1>`, not any artwork, and its median LCP moved 1040 ms →
1236 ms. That page is authoring chrome wrapped around the scene; the gameplay
dialogue surface has no such heading, and the artwork-completion numbers above
are the gameplay-relevant measurement. The most likely explanation is
main-thread/bandwidth contention from the now-eager portrait on a 4 Mbit/s link,
but that causal link was **not** verified and is worth re-checking during phone
acceptance. An earlier 5-run sample showed noticeably more scatter than the
9-run interleaved comparison; treat short single samples on this path as noisy.

**Not measured deployed:** the authenticated Location hero before/after, for the
preview-database reason in §10. Its before/after is §8.1 (local production
build), and the same scheduling mechanism is demonstrated deployed here.


## 9. Recommendations not implemented here

Each is evidence-backed but carries a product, art-contract or deployment
tradeoff that belongs to the product owner, so per Issue #117's decision
boundary they stop at a recommendation.

1. **Re-prepare the two legacy map identifiers** (`the-jag.png`,
   `the-long-scramble.png`) through the existing map-identifier pipeline in
   `docs/art-cookbook.md` (transparent, tightly trimmed, ≤512 px long edge,
   lossless WebP). Measured saving: ~1.06 MB of the Map surface's 1.51 MB. This
   is an approved-artwork change and the cookbook already flags it as pending
   art debt.
2. **Revisit the map-identifier size contract.** Even the compliant WebPs are
   96–121 KB lossless at 512 px for a ~140 px render. A smaller long edge or a
   lossy/alpha-preserving encode would cut the remaining ~450 KB, but that
   changes the documented pipeline and needs visual QA at map scale.
3. **Set `images.minimumCacheTTL`** in `next.config.ts` to remove the 60 s
   ceiling (§7.3). Tradeoff: `/_next/image` URLs carry no `?dpl=` deploy id, so
   artwork replaced at the same path would stay cached in browsers for the whole
   TTL. A moderate TTL (days, not a year) plus a path change whenever art is
   replaced is the safer shape. This also makes the container-local optimizer
   cache worth preserving across deployments, which is a separate deployment
   decision.
4. **Correct the two scene metadata entries** in `game/content/locations.ts` to
   the real 2508×627, and consider extending
   `tests/unit/location-scene.test.ts` to compare declared dimensions against
   the committed file headers so metadata cannot drift again.
5. **Reconsider the dialogue item reveal size** (325 KB for `power-cell.png` at
   `w=828`). The item masters are 1.1–1.8 MP PNGs with alpha; a prepared
   derivative or a tighter `sizes` for the reveal would cut this materially.
6. **Stop fetching the hidden public-site emblem** above the 390 px breakpoint,
   and consider whether the authenticated header lockup still deserves
   `priority` now that the hero scene is preloaded alongside it.

Explicitly **not** recommended on this evidence: adding a CDN, converting assets
to a new codec wholesale, re-encoding source masters, adding LQIP/blur
placeholders, or prefetching map artwork. None of them address a measured cause.

## 10. Limitations and unexecuted checks

- **The authenticated Play surface could not be measured on a deployed
  environment.** `pr-188`'s preview database is missing schema the play route
  needs, so `/play/<id>` renders the "Comms interruption" fault screen there
  (`docs/deployment-database.md`: migrations are an explicit operator action, not
  applied at startup). Applying migrations to the preview would have changed
  deployment state to make measurement easier, which Issue #117 forbids. The
  authenticated before/after in §8.1 is therefore from a **local production
  build** on Hermes. Everything it depends on that *is* deployment-sensitive —
  delivered bytes, format, candidate widths, cache headers, cold/warm behaviour,
  TTFB — was measured against the deployed site, and the same scheduling gap was
  reproduced deployed on `/qc-studio` (§5).
- Absolute timings are VPS-relative. **Final human acceptance on a real phone is
  still required**; a synthetic LCP improvement is not the acceptance criterion.
- AVIF was not evaluated. Next is serving WebP by default and no measurement
  implicated the codec.
- Holo Hollow's Local Place hero and directory thumbnails were measured by
  asset and by `sizes` contract, not by walking a character to Holo Hollow in a
  browser; they use the same `LocationSceneHeader` and the same `/_next/image`
  boundary as Crash Site.
- No production account, character, or row was created; no Coolify, Docker,
  proxy, or database state was modified anywhere except the disposable local
  `issue-117` database and the disposable preview review account.
