#!/usr/bin/env node
/**
 * Deterministic runtime derivatives for the Wise Old Enby's research-loan item art
 * (#406): the Sealed Research Packet, Geological Sample Case and Resonance Sampler.
 *
 * Inputs are the owner-approved 1254x1254 transparent RGBA masters, kept
 * byte-identical in `assets/item-art/` and checked against the SHA-256 of the
 * files the owner handed off, so a substituted or edited master is refused.
 *
 * Outputs (committed; never regenerated during build or at request time):
 * `public/item-art/<name>.webp`, by the Wheel Assembly convention: alpha noise
 * below 4 cleared, near-opaque alpha (252 and above) snapped to 255, trimmed to
 * content, scaled to a 576 px long edge, centred on a 640x640 transparent canvas,
 * lossless WebP. Nothing is regenerated, recomposed or recoloured.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-research-loan-art.mjs
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
    master: "sealed-research-packet.png",
    sha256: "4e4639f939767e7a38a4f579938ca006c64118f2631140ca67bcee80ed3e7d35",
    width: 1254,
    height: 1254,
    out: "sealed-research-packet.webp",
  },
  {
    master: "geological-sample-case.png",
    sha256: "e09e07ad91a8445e3f01a5d67100acb5204c18b6af184a0c3c2d78503312feb9",
    width: 1254,
    height: 1254,
    out: "geological-sample-case.webp",
  },
  {
    master: "resonance-sampler.png",
    sha256: "a64fde3215def4297f9f0245866d53d7251d11b8be7f05efa269603909ce8f2a",
    width: 1254,
    height: 1254,
    out: "resonance-sampler.webp",
  },
];

function verify(path, name, expected) {
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== expected) throw new Error(`${name} is not the approved file (sha256 ${digest}).`);
}

async function prepareItem(item) {
  const masterPath = join(repoRoot, "assets/item-art", item.master);
  const outPath = join(repoRoot, "public/item-art", item.out);
  verify(masterPath, item.master, item.sha256);
  const { data, info } = await sharp(masterPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== item.width || info.height !== item.height || info.channels !== 4) {
    throw new Error(`${item.master} must be a ${item.width}x${item.height} RGBA image`);
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

for (const item of ITEMS) await prepareItem(item);
