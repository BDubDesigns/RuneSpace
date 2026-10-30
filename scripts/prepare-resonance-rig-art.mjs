#!/usr/bin/env node
/**
 * Deterministic runtime derivative for the finished personal Resonance Rig (#441).
 *
 * Input is the owner-approved transparent master kept unaltered in
 * assets/location-scenes/:
 *   - resonance-rig-master.png  1536x1024 RGBA, SHA-256 2d873b23405a111760ae815e90822727b9b5984ddc80c5f11210d29c6e474d30
 *
 * Output (committed; never regenerated during build or at request time):
 *   - public/location-scenes/resonance-rig.webp  1152x768 RGBA, q85 / alpha 100
 *
 * The overlay recipe is the repository's direct-alpha recipe (docs/art-cookbook.md)
 * with one deliberate difference: the subject is NOT trimmed on its alpha bounds.
 * The owner chose the placement (left 36.5, top 20, width 29, percent of the shared
 * 1536x384 stage) against the full 3:2 canvas, so trimming would move the art off
 * the mark it was approved on. The canvas keeps its registration and is only scaled
 * down (never up) by 0.75. Alpha under 4 is cleared and near-opaque alpha (>= 240)
 * is snapped fully opaque.
 *
 * The script refuses to run against any master whose hash differs from the
 * approved one: the Rig is never regenerated, approximated or substituted.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-resonance-rig-art.mjs
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const requireFromNext = createRequire(
  createRequire(join(repoRoot, "package.json")).resolve("next"),
);
const sharp = requireFromNext("sharp");

const APPROVED_MASTER_SHA256 = "2d873b23405a111760ae815e90822727b9b5984ddc80c5f11210d29c6e474d30";
const MASTER = { width: 1536, height: 1024 };
const DELIVERED = { width: 1152, height: 768 };

const masterPath = join(repoRoot, "assets/location-scenes/resonance-rig-master.png");
const outPath = join(repoRoot, "public/location-scenes/resonance-rig.webp");

const hash = createHash("sha256").update(readFileSync(masterPath)).digest("hex");
if (hash !== APPROVED_MASTER_SHA256) {
  throw new Error(
    `resonance-rig-master.png hash ${hash} is not the approved master ${APPROVED_MASTER_SHA256}.`,
  );
}

const { data, info } = await sharp(masterPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (info.width !== MASTER.width || info.height !== MASTER.height) {
  throw new Error(`Unexpected master size ${info.width}x${info.height}.`);
}
for (let i = 3; i < data.length; i += info.channels) {
  if (data[i] < 4) data[i] = 0;
  else if (data[i] >= 240) data[i] = 255;
}
await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
  .resize(DELIVERED.width, DELIVERED.height, { kernel: "lanczos3" })
  .webp({ quality: 85, alphaQuality: 100, effort: 6 })
  .toFile(outPath);
console.log(
  `resonance-rig.webp ${DELIVERED.width}x${DELIVERED.height} ${statSync(outPath).size} bytes`,
);
