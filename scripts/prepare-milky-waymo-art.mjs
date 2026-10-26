#!/usr/bin/env node
/**
 * Deterministic runtime derivatives for Stillreach Slice K's owner-approved art
 * (issue #404): Milky Waymo's two Local Place scenes, its transparent passenger
 * shuttle and its logo.
 *
 * Inputs are the approved masters from the owner's handoff ZIP, kept unaltered in
 * `assets/` and checked against the SHA-256 the handoff recorded, so a substituted
 * or edited master is refused:
 *   - assets/location-scenes/milky-waymo-spaceport-check-in-master.png
 *     2508x627 opaque RGB, the Skatboll check-in (paved apron)
 *   - assets/location-scenes/milky-waymo-outpost-under-aurora-skies-master.png
 *     2508x627 opaque RGB, the Stillreach check-in (bare soil, no pavement)
 *   - assets/location-scenes/milky-waymo-shuttle-transparent-master.png
 *     1774x887 RGBA, the corrected passenger shuttle with the exact M/W marks
 *   - assets/branding/milky-waymo-logo-reference.png
 *     the owner-provided logo lockup on white
 *   - assets/branding/milky-waymo-mark-cutout.png
 *     1222x319 RGBA, the M/W mark alone
 *
 * Outputs (committed; never regenerated during build or at request time):
 *   - public/location-scenes/milky-waymo-spaceport-check-in.webp
 *   - public/location-scenes/milky-waymo-outpost-under-aurora-skies.webp
 *     1536x384 lossy WebP q80, downsampled whole (never upscaled or cropped) to the
 *     proven Local Place production size
 *   - public/location-scenes/milky-waymo-shuttle.webp
 *     the Rivet overlay recipe (docs/art-cookbook.md): alpha under 4 cleared,
 *     near-opaque alpha snapped opaque, trimmed on its alpha bounds, scaled 0.75
 *   - public/branding/milky-waymo-logo.webp, milky-waymo-mark.webp
 *     the approved logo, margins trimmed, at 2x of its largest display size; the
 *     mark and wordmark are never redrawn, recoloured or re-spaced
 *
 * It prints the shuttle's trim bounds on its untrimmed 1774x887 canvas, which
 * `game/content/flight-cinematics.ts` uses to seat the shuttle on the Rivet's
 * measured marks.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-milky-waymo-art.mjs
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

const SCENES = [
  {
    master: "assets/location-scenes/milky-waymo-spaceport-check-in-master.png",
    sha256: "d18cb7d80c471c59dd3dba4b15a106fbb65c23680a0be421563bd1ad4ea970d3",
    out: "public/location-scenes/milky-waymo-spaceport-check-in.webp",
  },
  {
    master: "assets/location-scenes/milky-waymo-outpost-under-aurora-skies-master.png",
    sha256: "ed653662460d6eac4718ae9ab5a060cc505aa032222bb9ec4cad29ed5113b16e",
    out: "public/location-scenes/milky-waymo-outpost-under-aurora-skies.webp",
  },
];
const SCENE_MASTER = { width: 2508, height: 627 };
const SCENE_OUT = { width: 1536, height: 384 };

const SHUTTLE = {
  master: "assets/location-scenes/milky-waymo-shuttle-transparent-master.png",
  sha256: "97e2140813c04b3e24d02dc71cae2d21d9f20f56fb005c53f6144e16067179ce",
  size: { width: 1774, height: 887 },
  out: "public/location-scenes/milky-waymo-shuttle.webp",
};
const OVERLAY_SCALE = 0.75;

/** Even margin, in pixels, kept around the trimmed logo artwork. */
const LOGO_MARGIN = 8;

const LOGOS = [
  {
    master: "assets/branding/milky-waymo-logo-reference.png",
    sha256: "bfbf4cb35f1924020271f8efc8fe50afeaedbf4e2397387646f8eb3ebdc682f0",
    out: "public/branding/milky-waymo-logo.webp",
    width: 720,
    background: "#ffffff",
  },
  {
    master: "assets/branding/milky-waymo-mark-cutout.png",
    sha256: "b3344c5d7cbcfe9a58a8f6a9934e1ec573deb07654a545fd0dd13a5fa5c0392a",
    out: "public/branding/milky-waymo-mark.webp",
    width: 640,
    background: { r: 255, g: 255, b: 255, alpha: 0 },
  },
];

function verify(relativePath, expected) {
  const digest = createHash("sha256")
    .update(readFileSync(join(repoRoot, relativePath)))
    .digest("hex");
  if (digest !== expected) {
    throw new Error(`${relativePath} is not the approved file (sha256 ${digest}).`);
  }
}

for (const scene of SCENES) {
  verify(scene.master, scene.sha256);
  const input = join(repoRoot, scene.master);
  const meta = await sharp(input).metadata();
  if (meta.width !== SCENE_MASTER.width || meta.height !== SCENE_MASTER.height) {
    throw new Error(`${scene.master} must be 2508x627, got ${meta.width}x${meta.height}`);
  }
  await sharp(input)
    .removeAlpha()
    .resize(SCENE_OUT.width, SCENE_OUT.height, { kernel: "lanczos3" })
    .webp({ quality: 80, effort: 6 })
    .toFile(join(repoRoot, scene.out));
  console.log(`${scene.out} 1536x384 ${statSync(join(repoRoot, scene.out)).size} bytes`);
}

verify(SHUTTLE.master, SHUTTLE.sha256);
{
  const { data, info } = await sharp(join(repoRoot, SHUTTLE.master))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (width !== SHUTTLE.size.width || height !== SHUTTLE.size.height || channels !== 4) {
    throw new Error(`${SHUTTLE.master} must be 1774x887 RGBA, got ${width}x${height}x${channels}`);
  }
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
    .toFile(join(repoRoot, SHUTTLE.out));
  console.log(
    `${SHUTTLE.out} ${delivered.width}x${delivered.height} ${statSync(join(repoRoot, SHUTTLE.out)).size} bytes trim ${JSON.stringify(crop)}`,
  );
}

for (const logo of LOGOS) {
  verify(logo.master, logo.sha256);
  // Trim only the empty margin (near-white on the opaque lockup, transparent on the
  // cutout), then give the artwork back a small even margin so no anti-aliased edge
  // of the mark is left touching the file's border, and scale it down (never up).
  const trimmed = await sharp(join(repoRoot, logo.master))
    .trim({ background: logo.background, threshold: 6 })
    .toBuffer();
  const content = logo.width - 2 * LOGO_MARGIN;
  const resized = await sharp(trimmed)
    .resize(content, null, { kernel: "lanczos3", withoutEnlargement: true })
    .toBuffer();
  await sharp(resized)
    .extend({
      top: LOGO_MARGIN,
      bottom: LOGO_MARGIN,
      left: LOGO_MARGIN,
      right: LOGO_MARGIN,
      background: logo.background,
    })
    .webp({ lossless: true, effort: 6 })
    .toFile(join(repoRoot, logo.out));
  const meta = await sharp(join(repoRoot, logo.out)).metadata();
  console.log(
    `${logo.out} ${meta.width}x${meta.height} ${statSync(join(repoRoot, logo.out)).size} bytes`,
  );
}
