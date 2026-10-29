#!/usr/bin/env node
/**
 * Deterministic runtime derivative for Lapidary's owner-approved item art (issue
 * #431): the Cut Quartz.
 *
 * The input is the approved 1254x1254 transparent RGBA master, kept
 * byte-identical in assets/item-art/ and checked against the SHA-256 of the file
 * the owner handed off, so a substituted or edited master is refused.
 *
 * The derivative follows the Wheel Assembly / Rune Fragment convention: alpha
 * noise below 4 cleared, near-opaque alpha (252 and above) snapped to 255,
 * trimmed to its alpha bounds, scaled to a 576 px long edge (never stretched),
 * centred on a 640x640 transparent canvas and saved as lossless WebP. Nothing is
 * regenerated, recomposed or recoloured.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-cut-quartz-art.mjs
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

const ITEM = {
  master: "cut-quartz.png",
  sha256: "2a38007a0963f449aef58fe8e776c9a709e336deb604d179354bfd20eb9e422c",
  width: 1254,
  height: 1254,
  out: "cut-quartz.webp",
};

const masterPath = join(repoRoot, "assets/item-art", ITEM.master);
const outPath = join(repoRoot, "public/item-art", ITEM.out);
const digest = createHash("sha256").update(readFileSync(masterPath)).digest("hex");
if (digest !== ITEM.sha256) {
  throw new Error(`${ITEM.master} is not the approved file (sha256 ${digest}).`);
}
const { data, info } = await sharp(masterPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
if (info.width !== ITEM.width || info.height !== ITEM.height || info.channels !== 4) {
  throw new Error(`${ITEM.master} must be a ${ITEM.width}x${ITEM.height} RGBA image`);
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
  `${ITEM.out} trimmed ${trimInfo.width}x${trimInfo.height} -> ${width}x${height} on ${CANVAS}x${CANVAS}, ${statSync(outPath).size} bytes`,
);
