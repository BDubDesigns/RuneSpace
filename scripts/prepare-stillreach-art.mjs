#!/usr/bin/env node
/**
 * Deterministic derivatives for Stillreach Slice A (issue #373): eight empty 4:1
 * location panoramas and eight transparent local-map identifiers.
 *
 * Inputs are the owner-approved masters, kept unaltered under assets/:
 *   - assets/location-scenes/<slug>-master.png  4:1 opaque panoramas (seven 2508x627,
 *     The Survey Line 2048x512)
 *   - assets/map-icons/<slug>.png               1254x1254 direct-alpha RGBA identifiers
 *
 * Outputs (committed; never regenerated during build or at request time):
 *   - public/location-scenes/<slug>.webp  1536x384 opaque lossy WebP q80
 *   - public/map-icons/<slug>.webp        trimmed grayscale lossless WebP, 512 px long edge
 *
 * Scenes are downsampled (never upscaled) to the 1536x384 production size that
 * docs/art-cookbook.md accepts, and flattened because environment art is opaque.
 * Identifiers follow the direct-alpha recipe in docs/art-cookbook.md: alpha under 4
 * is cleared, near-opaque alpha (>= 240) is snapped fully opaque, the subject is
 * trimmed on its alpha bounds, scaled down (never up), and only then converted to
 * grayscale. Nothing is regenerated, recoloured or redesigned.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-stillreach-art.mjs
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

const SLUGS = [
  "stillreach-landing-station",
  "windward-track",
  "hilltop-workshop",
  "prospecting-quarry",
  "the-low-hum",
  "the-survey-line",
  "the-dry-seam",
  "harmonic-workings",
];
const SCENE = { width: 1536, height: 384 };
const ICON_LONG_EDGE = 512;

for (const slug of SLUGS) {
  const sceneOut = join(repoRoot, `public/location-scenes/${slug}.webp`);
  const master = sharp(join(repoRoot, `assets/location-scenes/${slug}-master.png`));
  const meta = await master.metadata();
  if (meta.width !== meta.height * 4) {
    throw new Error(`${slug} master must be 4:1, got ${meta.width}x${meta.height}`);
  }
  if (meta.width < SCENE.width) {
    throw new Error(`${slug} master would have to be upscaled to ${SCENE.width}x${SCENE.height}`);
  }
  await master
    .removeAlpha()
    .resize(SCENE.width, SCENE.height, { kernel: "lanczos3" })
    .webp({ quality: 80, effort: 6 })
    .toFile(sceneOut);
  console.log(`${slug} scene ${SCENE.width}x${SCENE.height} ${statSync(sceneOut).size} bytes`);

  const { data, info } = await sharp(join(repoRoot, `assets/map-icons/${slug}.png`))
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
  const iconOut = join(repoRoot, `public/map-icons/${slug}.webp`);
  const trimmed = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
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
  console.log(`${slug} icon ${iconMeta.width}x${iconMeta.height} ${statSync(iconOut).size} bytes`);
}
