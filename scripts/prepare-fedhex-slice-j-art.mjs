#!/usr/bin/env node
/**
 * Deterministic runtime derivatives for Stillreach Slice J's owner-approved art
 * (issue #399): the shared FedHex interior Local Place scene, Miner's Boots and
 * Miner's Gloves.
 *
 * Inputs are the approved masters, kept byte-identical in `assets/` and checked
 * against the SHA-256 of the files the owner handed off, so a substituted or
 * edited master is refused:
 *   - assets/location-scenes/fedhex-parcel-hub-master.png
 *     2508x627 opaque RGB, the true 4:1 FedHex interior, shared by both FedHex
 *     Local Places
 *   - assets/item-art/miners-boots.png, assets/item-art/miners-gloves.png
 *     1254x1254 transparent RGBA
 *
 * Outputs (committed; never regenerated during build or at request time):
 *   - public/location-scenes/fedhex-parcel-hub.webp
 *     1536x384 lossy WebP q80, downsampled (never upscaled or cropped) to the
 *     proven Local Place production size, as the Refiner-To-Go scene was
 *   - public/item-art/miners-boots.webp, public/item-art/miners-gloves.webp
 *     The Wheel Assembly convention: alpha noise below 4 cleared, near-opaque
 *     alpha (252 and above) snapped to 255, trimmed to content, scaled to a
 *     576 px long edge, centred on a 640x640 transparent canvas, lossless WebP
 *
 * Nothing is regenerated, recomposed or recoloured, and no rarity effect is
 * baked in: the Legendary sparkles and sweep are coded UI.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-fedhex-slice-j-art.mjs
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

const SCENE = {
  master: "fedhex-parcel-hub-master.png",
  sha256: "04b35967e1fe37485603d268029ffeb3d8efef3dece4e8c836d05237f68f5381",
  masterSize: { width: 2508, height: 627 },
  out: "fedhex-parcel-hub.webp",
  outSize: { width: 1536, height: 384 },
};

const ITEMS = [
  {
    master: "miners-boots.png",
    sha256: "dba7d2f2021f0c452754a4aa3ce88ddd136eae1b2116911449aca89b7bfee9ee",
    width: 1254,
    height: 1254,
    out: "miners-boots.webp",
  },
  {
    master: "miners-gloves.png",
    sha256: "bb219b38c4701c7536e4888571e8cdaf017afe1be040e07f02f67f3c14b21a11",
    width: 1254,
    height: 1254,
    out: "miners-gloves.webp",
  },
];

function verify(path, name, expected) {
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== expected) throw new Error(`${name} is not the approved file (sha256 ${digest}).`);
}

async function prepareScene() {
  const masterPath = join(repoRoot, "assets/location-scenes", SCENE.master);
  const outPath = join(repoRoot, "public/location-scenes", SCENE.out);
  verify(masterPath, SCENE.master, SCENE.sha256);
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

await prepareScene();
for (const item of ITEMS) await prepareItem(item);
