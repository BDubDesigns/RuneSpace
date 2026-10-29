#!/usr/bin/env node
/**
 * Deterministic derivatives for Werner's Lab (issue #429): the seven owner-approved
 * masters from the handoff ZIP.
 *
 * Inputs are kept unaltered under assets/ and checked against the SHA-256 of the files
 * the owner handed off, so a substituted or edited master is refused:
 *   - assets/npc-art/werner/werner-{neutral,thoughtful,amused,intense}-master.png
 *     1086x1448 transparent RGBA, one shared canvas
 *   - assets/location-scenes/werner-lab-master.png
 *     2508x627 opaque RGB, the 4:1 World Location exterior
 *   - assets/location-scenes/werner-lab-dialogue-interior-master.png
 *     1717x916 opaque RGB, the empty lab interior composed for the 15:8 DialogueScene
 *   - assets/map-icons/werner-lab.png
 *     1536x1024 grayscale RGBA direct-alpha identifier
 *
 * Outputs (committed; never regenerated during build or at request time):
 *   - public/npc-art/werner-{expression}.png
 *     400x500 transparent PNG. The masters are 3:4, not 4:5, so each is scaled
 *     uniformly to the 500 px height (1086x1448 -> 375x500) and centred on a shared
 *     transparent 400x500 canvas with 12-13 px of empty margin either side. The four
 *     expressions keep one canvas and switch in place. Never cropped, recoloured or
 *     stretched.
 *   - public/location-scenes/werner-lab.webp
 *     1536x384 opaque lossy WebP q80, downsampled whole (never upscaled).
 *   - public/location-scenes/werner-lab-interior.webp
 *     1710x912 lossy WebP q80: the largest exact 15:8 rectangle centred in the
 *     master, with no resampling at all, so nothing is warped.
 *   - public/map-icons/werner-lab.webp
 *     Trimmed grayscale lossless WebP, 512 px long edge, by the direct-alpha recipe in
 *     docs/art-cookbook.md: alpha under 4 cleared, near-opaque alpha (>= 240) snapped
 *     fully opaque, trimmed on its alpha bounds, scaled down, then grayscaled.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-werner-lab-art.mjs
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

const PORTRAIT = { width: 400, height: 500 };
const PORTRAIT_MASTER_SIZE = { width: 1086, height: 1448 };
const PORTRAITS = [
  {
    expression: "neutral",
    sha256: "e96bac935690d4b56f58f8029e17d9fd070a0f4828059d2f0a3696d933f97835",
  },
  {
    expression: "thoughtful",
    sha256: "a7959c6e7fa3db6871a45a06b79564ecf887a866b1dbecb8a86b63a27635fca3",
  },
  {
    expression: "amused",
    sha256: "88589f8cc26cc80f39c0e6139f0f065f38b3446b06bfa84e5334ab06f938527a",
  },
  {
    expression: "intense",
    sha256: "0e437862a2ac1676154a1be4687251362fc4f348599995475cd3ad6fb1522803",
  },
];

const EXTERIOR = {
  master: "assets/location-scenes/werner-lab-master.png",
  sha256: "73d35b87d57e60d2716fd8e61d6d0e98baa9434142661f0d493dd7774d493141",
  masterSize: { width: 2508, height: 627 },
  out: "public/location-scenes/werner-lab.webp",
  outSize: { width: 1536, height: 384 },
};

const INTERIOR = {
  master: "assets/location-scenes/werner-lab-dialogue-interior-master.png",
  sha256: "26fc34d06e9090369738779aa888b0fd5a863b4d03ad454c36604d5efb4dd6a1",
  masterSize: { width: 1717, height: 916 },
  out: "public/location-scenes/werner-lab-interior.webp",
  outSize: { width: 1710, height: 912 },
};

const ICON = {
  master: "assets/map-icons/werner-lab.png",
  sha256: "0ae3086c63ae15cf5e2e1b5d87a80cc126e038892c237d3f58f6da4e5a25de03",
  masterSize: { width: 1536, height: 1024 },
  out: "public/map-icons/werner-lab.webp",
  longEdge: 512,
};

async function verifiedMaster(path, sha256, size) {
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== sha256) throw new Error(`${path} is not the approved file (sha256 ${digest}).`);
  const meta = await sharp(path).metadata();
  if (meta.width !== size.width || meta.height !== size.height) {
    throw new Error(
      `${path} must be ${size.width}x${size.height}, got ${meta.width}x${meta.height}`,
    );
  }
}

function report(path, width, height) {
  console.log(`${path} ${width}x${height} ${statSync(path).size} bytes`);
}

for (const portrait of PORTRAITS) {
  const masterPath = join(
    repoRoot,
    "assets/npc-art/werner",
    `werner-${portrait.expression}-master.png`,
  );
  const outPath = join(repoRoot, "public/npc-art", `werner-${portrait.expression}.png`);
  await verifiedMaster(masterPath, portrait.sha256, PORTRAIT_MASTER_SIZE);
  // One uniform factor, height-led; the 3:4 result is seated on the shared 4:5 canvas.
  await sharp(masterPath)
    .resize({
      width: PORTRAIT.width,
      height: PORTRAIT.height,
      fit: "contain",
      position: "centre",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: "lanczos3",
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath);
  const out = await sharp(outPath).metadata();
  if (out.width !== PORTRAIT.width || out.height !== PORTRAIT.height || !out.hasAlpha) {
    throw new Error(`${outPath} must be a ${PORTRAIT.width}x${PORTRAIT.height} RGBA portrait`);
  }
  report(outPath, out.width, out.height);
}

const exteriorMaster = join(repoRoot, EXTERIOR.master);
const exteriorOut = join(repoRoot, EXTERIOR.out);
await verifiedMaster(exteriorMaster, EXTERIOR.sha256, EXTERIOR.masterSize);
if (EXTERIOR.masterSize.width < EXTERIOR.outSize.width) {
  throw new Error("The exterior master would have to be upscaled");
}
await sharp(exteriorMaster)
  .removeAlpha()
  .resize(EXTERIOR.outSize.width, EXTERIOR.outSize.height, { kernel: "lanczos3" })
  .webp({ quality: 80, effort: 6 })
  .toFile(exteriorOut);
report(exteriorOut, EXTERIOR.outSize.width, EXTERIOR.outSize.height);

const interiorMaster = join(repoRoot, INTERIOR.master);
const interiorOut = join(repoRoot, INTERIOR.out);
await verifiedMaster(interiorMaster, INTERIOR.sha256, INTERIOR.masterSize);
if (INTERIOR.outSize.width * 8 !== INTERIOR.outSize.height * 15) {
  throw new Error("The interior derivative must be exactly 15:8");
}
await sharp(interiorMaster)
  .removeAlpha()
  .extract({
    left: Math.floor((INTERIOR.masterSize.width - INTERIOR.outSize.width) / 2),
    top: Math.floor((INTERIOR.masterSize.height - INTERIOR.outSize.height) / 2),
    width: INTERIOR.outSize.width,
    height: INTERIOR.outSize.height,
  })
  .webp({ quality: 80, effort: 6 })
  .toFile(interiorOut);
report(interiorOut, INTERIOR.outSize.width, INTERIOR.outSize.height);

const iconMaster = join(repoRoot, ICON.master);
await verifiedMaster(iconMaster, ICON.sha256, ICON.masterSize);
const { data, info } = await sharp(iconMaster)
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
const iconOut = join(repoRoot, ICON.out);
const trimmed = await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .trim({ threshold: 0 })
  .png()
  .toBuffer({ resolveWithObject: true });
const longEdge = Math.max(trimmed.info.width, trimmed.info.height);
const scale = Math.min(1, ICON.longEdge / longEdge);
await sharp(trimmed.data)
  .resize(Math.round(trimmed.info.width * scale), Math.round(trimmed.info.height * scale), {
    kernel: "lanczos3",
  })
  .grayscale()
  .webp({ lossless: true, effort: 6 })
  .toFile(iconOut);
const iconMeta = await sharp(iconOut).metadata();
report(iconOut, iconMeta.width, iconMeta.height);
