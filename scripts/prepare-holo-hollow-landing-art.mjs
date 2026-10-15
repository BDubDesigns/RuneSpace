#!/usr/bin/env node
/**
 * Deterministic derivatives for Holo Hollow Landing (issue #357).
 *
 * Inputs are the approved masters kept unaltered under assets/:
 *   - assets/location-scenes/holo-hollow-landing-master.png  1536x384 opaque, shipless pad
 *   - assets/map-icons/holo-hollow-landing.png               1254x1254 RGBA H.H. identifier
 *
 * Outputs (committed; never regenerated during build or at request time):
 *   - public/location-scenes/holo-hollow-landing.webp  1536x384 opaque lossy WebP q80
 *   - public/map-icons/holo-hollow-landing.webp         trimmed grayscale lossless WebP, 512 px long edge
 *
 * The identifier follows the direct-alpha recipe in docs/art-cookbook.md: alpha under
 * 4 is cleared, near-opaque alpha (>= 240) is snapped fully opaque, the subject is
 * trimmed on its alpha bounds, scaled down (never up), and only then converted to
 * grayscale. The Landing panorama is already the delivered 4:1 size, so it is only
 * re-encoded, never resampled.
 *
 * The Last Leg Trading scenes and Toll Kade's four portraits arrived as approved
 * production derivatives and are committed as delivered; their masters sit beside
 * these in assets/.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-holo-hollow-landing-art.mjs
 */
import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromNext = createRequire(
  createRequire(join(repoRoot, "package.json")).resolve("next"),
);
const sharp = requireFromNext("sharp");

const LANDING = { width: 1536, height: 384 };
const ICON_LONG_EDGE = 512;

const landingOut = join(repoRoot, "public/location-scenes/holo-hollow-landing.webp");
const landingMaster = sharp(
  join(repoRoot, "assets/location-scenes/holo-hollow-landing-master.png"),
);
const landingMeta = await landingMaster.metadata();
if (landingMeta.width !== LANDING.width || landingMeta.height !== LANDING.height) {
  throw new Error(
    `Landing master must already be ${LANDING.width}x${LANDING.height}, got ${landingMeta.width}x${landingMeta.height}`,
  );
}
await landingMaster.removeAlpha().webp({ quality: 80, effort: 6 }).toFile(landingOut);
console.log(
  `holo-hollow-landing.webp ${LANDING.width}x${LANDING.height} ${statSync(landingOut).size} bytes`,
);

const { data, info } = await sharp(join(repoRoot, "assets/map-icons/holo-hollow-landing.png"))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
for (let offset = 3; offset < data.length; offset += 4) {
  const alpha = data[offset];
  if (alpha < 4) {
    data[offset - 3] = 0;
    data[offset - 2] = 0;
    data[offset - 1] = 0;
    data[offset] = 0;
  } else if (alpha >= 240) {
    data[offset] = 255;
  }
}
const iconOut = join(repoRoot, "public/map-icons/holo-hollow-landing.webp");
const trimmed = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .trim({ threshold: 0 })
  .png()
  .toBuffer({ resolveWithObject: true });
const longEdge = Math.max(trimmed.info.width, trimmed.info.height);
const scale = Math.min(1, ICON_LONG_EDGE / longEdge);
await sharp(trimmed.data)
  .resize(Math.round(trimmed.info.width * scale), Math.round(trimmed.info.height * scale), {
    kernel: "lanczos3",
  })
  .grayscale()
  .webp({ lossless: true, effort: 6 })
  .toFile(iconOut);
const iconMeta = await sharp(iconOut).metadata();
console.log(
  `holo-hollow-landing icon ${iconMeta.width}x${iconMeta.height} ${statSync(iconOut).size} bytes`,
);
