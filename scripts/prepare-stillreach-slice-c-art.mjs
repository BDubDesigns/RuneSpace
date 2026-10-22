#!/usr/bin/env node
/**
 * Deterministic runtime derivatives for Stillreach Slice C's owner-approved item
 * art (issue #379): the Stone and the Boulder.
 *
 * Inputs are the approved 1254x1254 transparent masters, kept byte-identical in
 * assets/item-art/ and checked against the SHA-256 of the files the owner handed
 * off, so a substituted or edited master is refused.
 *
 * Each derivative follows the Wheel Assembly / Oil Shale convention: alpha noise
 * below 4 cleared, near-opaque alpha (252 and above) snapped to 255, trimmed to
 * its alpha bounds, scaled to a 576 px long edge (never stretched), centred on a
 * 640x640 transparent canvas and saved as lossless WebP. Nothing is regenerated,
 * recomposed or recoloured, and no sparkle is baked in: the Ultra Rare shimmer is
 * the UI's.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-stillreach-slice-c-art.mjs
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

const CANVAS = 640;
const LONG_EDGE = 576;

const ITEMS = [
  {
    master: "stone.png",
    sha256: "32b4c81efa9b329121357d91c3c33c5eb2b0e6dc1a8f81ccedca774553a692f0",
    out: "stone.webp",
  },
  {
    master: "boulder.png",
    sha256: "e8fa6256f99405e04150b782c061b3e937b278a320b761e363e49e8f8afdf875",
    out: "boulder.webp",
  },
];

for (const item of ITEMS) {
  const masterPath = join(repoRoot, "assets/item-art", item.master);
  const outPath = join(repoRoot, "public/item-art", item.out);
  const digest = createHash("sha256").update(readFileSync(masterPath)).digest("hex");
  if (digest !== item.sha256) {
    throw new Error(`${item.master} is not the approved file (sha256 ${digest}).`);
  }
  const { data, info } = await sharp(masterPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 1254 || info.height !== 1254 || info.channels !== 4) {
    throw new Error(`${item.master} must be a 1254x1254 RGBA image`);
  }
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 4) data[i] = 0;
    else if (data[i] >= 252) data[i] = 255;
  }
  const cleaned = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  const trimmed = await cleaned.png().toBuffer();
  const trimmedImage = sharp(trimmed).trim({ threshold: 0 });
  const { info: trimInfo } = await trimmedImage.toBuffer({ resolveWithObject: true });
  const scale = LONG_EDGE / Math.max(trimInfo.width, trimInfo.height);
  const width = Math.round(trimInfo.width * scale);
  const height = Math.round(trimInfo.height * scale);
  const scaled = await trimmedImage.resize(width, height, { kernel: "lanczos3" }).png().toBuffer();
  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: scaled,
        left: Math.floor((CANVAS - width) / 2),
        top: Math.floor((CANVAS - height) / 2),
      },
    ])
    .webp({ lossless: true, effort: 6 })
    .toFile(outPath);
  console.log(
    `${item.out} trimmed ${trimInfo.width}x${trimInfo.height} -> ${width}x${height} on ${CANVAS}x${CANVAS}, ${statSync(outPath).size} bytes`,
  );
}
