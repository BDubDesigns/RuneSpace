#!/usr/bin/env node
/**
 * Deterministic derivative for Stillreach Slice E's owner-approved art (issue #381).
 *
 * Input is the approved master, kept unaltered and checked against the SHA-256
 * of the file the owner handed off, so a substituted or edited master is refused:
 *   - assets/location-scenes/refiner-to-go-master.png
 *     2172x543 opaque RGB, the true 4:1 Refiner-To-Go Local Place scene
 *
 * Output (committed; never regenerated during build or at request time):
 *   - public/location-scenes/refiner-to-go.webp
 *     1536x384 lossy WebP q80, downsampled (never upscaled) to the proven Local
 *     Place production size exactly as Slice B treated the fuel terminal scene
 *
 * Nothing is cropped, recoloured or regenerated, and no UI is composited: the
 * scene is flattened and resampled whole, preserving its approved composition.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-refiner-to-go-art.mjs
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

const SCENE = {
  master: "refiner-to-go-master.png",
  sha256: "72e94c3efdf2b52af012c5c26f82c7fd7388bdd84ee16a55265c95571b9886de",
  masterSize: { width: 2172, height: 543 },
  out: "refiner-to-go.webp",
  outSize: { width: 1536, height: 384 },
};

const masterPath = join(repoRoot, "assets/location-scenes", SCENE.master);
const outPath = join(repoRoot, "public/location-scenes", SCENE.out);
const digest = createHash("sha256").update(readFileSync(masterPath)).digest("hex");
if (digest !== SCENE.sha256) {
  throw new Error(`${SCENE.master} is not the approved file (sha256 ${digest}).`);
}
const meta = await sharp(masterPath).metadata();
if (meta.width !== SCENE.masterSize.width || meta.height !== SCENE.masterSize.height) {
  throw new Error(
    `${SCENE.master} must be ${SCENE.masterSize.width}x${SCENE.masterSize.height}, got ${meta.width}x${meta.height}`,
  );
}
if (meta.width < SCENE.outSize.width) throw new Error(`${SCENE.master} would be upscaled`);
await sharp(masterPath)
  .removeAlpha()
  .resize(SCENE.outSize.width, SCENE.outSize.height, { kernel: "lanczos3" })
  .webp({ quality: 80, effort: 6 })
  .toFile(outPath);
console.log(
  `${SCENE.out} ${SCENE.outSize.width}x${SCENE.outSize.height} ${statSync(outPath).size} bytes`,
);
