#!/usr/bin/env node
/**
 * Deterministic derivatives for the Crash Site's layered scene (issue #351).
 *
 * Inputs are the three approved masters kept unaltered in assets/location-scenes/:
 *   - crash-site-empty-overcast-master.png  2508x627 opaque empty environment
 *   - rivet-crashed-transparent-master.png  1672x941 RGBA damaged ship + debris
 *   - rivet-repaired-transparent-master.png 1774x887 RGBA repaired ship
 *
 * Outputs (committed; never regenerated during build or at request time):
 *   - public/location-scenes/crash-site-empty.webp  1536x384 opaque, q80
 *   - public/location-scenes/rivet-crashed.webp     alpha-preserving, trimmed
 *   - public/location-scenes/rivet-repaired.webp    alpha-preserving, trimmed
 *
 * The overlay recipe is the repository's direct-alpha recipe (docs/art-cookbook.md):
 * alpha under 4 is cleared, near-opaque alpha (>= 240) is snapped fully opaque, the
 * subject is trimmed on its alpha bounds, then scaled down (never up). It prints the
 * scene-relative placement of each trimmed overlay so the authored metadata in
 * game/content/locations.ts can be checked against it. Both ships are measured from
 * one reference box on the untrimmed master canvas, so trimming never moves a ship.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-crash-site-art.mjs
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

const masters = join(repoRoot, "assets/location-scenes");
const out = join(repoRoot, "public/location-scenes");

const BASE_MASTER = { width: 2508, height: 627 };
const BASE_DELIVERED = { width: 1536, height: 384 };
/** Both overlays are delivered at the same fraction of their master pixels. */
const OVERLAY_SCALE = 0.75;
/**
 * Where an untrimmed overlay canvas sits on the base canvas, in percent of the base
 * canvas (the issue's starting composition, tuned by visual QA): left, top, width.
 */
const REFERENCE_BOX = { left: 34, top: 25, width: 32 };

const round = (n, places = 3) => Number(n.toFixed(places));

await sharp(join(masters, "crash-site-empty-overcast-master.png"))
  .resize(BASE_DELIVERED.width, BASE_DELIVERED.height, { kernel: "lanczos3" })
  .removeAlpha()
  .webp({ quality: 80, effort: 6 })
  .toFile(join(out, "crash-site-empty.webp"));
console.log(
  `crash-site-empty.webp ${BASE_DELIVERED.width}x${BASE_DELIVERED.height} ${statSync(join(out, "crash-site-empty.webp")).size} bytes`,
);

async function prepareOverlay(masterName, outName) {
  const { data, info } = await sharp(join(masters, masterName))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels + 3;
      if (data[i] < 4) data[i] = 0;
      else if (data[i] >= 240) data[i] = 255;
      if (data[i] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const crop = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const delivered = {
    width: Math.round(crop.width * OVERLAY_SCALE),
    height: Math.round(crop.height * OVERLAY_SCALE),
  };
  await sharp(data, { raw: { width, height, channels } })
    .extract(crop)
    .resize(delivered.width, delivered.height, { kernel: "lanczos3" })
    .webp({ quality: 85, alphaQuality: 100, effort: 6 })
    .toFile(join(out, outName));

  // Percent of the base canvas: the reference box scales the master canvas, and the
  // trimmed crop sits at its own offset inside that canvas.
  const baseUnitsPerMasterPx = ((REFERENCE_BOX.width / 100) * BASE_MASTER.width) / width;
  const placement = {
    left: round(REFERENCE_BOX.left + (crop.left * baseUnitsPerMasterPx * 100) / BASE_MASTER.width),
    top: round(REFERENCE_BOX.top + (crop.top * baseUnitsPerMasterPx * 100) / BASE_MASTER.height),
    width: round((crop.width * baseUnitsPerMasterPx * 100) / BASE_MASTER.width),
  };
  console.log(
    `${outName} ${delivered.width}x${delivered.height} ${statSync(join(out, outName)).size} bytes placement ${JSON.stringify(placement)}`,
  );
}

await prepareOverlay("rivet-crashed-transparent-master.png", "rivet-crashed.webp");
await prepareOverlay("rivet-repaired-transparent-master.png", "rivet-repaired.webp");
