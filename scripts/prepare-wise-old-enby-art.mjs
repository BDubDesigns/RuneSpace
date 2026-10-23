#!/usr/bin/env node
/**
 * Deterministic derivatives for Stillreach Slice G's owner-approved art (issue #389).
 *
 * Inputs are the five approved masters, kept unaltered and checked against the
 * SHA-256 of the files the owner handed off, so a substituted or edited master is
 * refused:
 *   - assets/npc-art/wise-old-enby/wise-old-enby-{neutral,friendly,thoughtful,amused}-master.png
 *     1122x1402 transparent RGBA, knee-cropped, one shared canvas
 *   - assets/location-scenes/hilltop-workshop-dialogue-interior-master.png
 *     1717x916 opaque RGB, the empty workshop interior composed for the 15:8 DialogueScene
 *
 * Outputs (committed; never regenerated during build or at request time):
 *   - public/npc-art/wise-old-enby-{expression}.png
 *     400x500 transparent PNG: each master scaled down uniformly to the 500 px
 *     height of the shared portrait contract (1122x1402 -> 400x500, within a
 *     fraction of a pixel), so the four expressions keep one canvas and switch in
 *     place. Never cropped, recoloured or stretched.
 *   - public/location-scenes/hilltop-workshop-interior.webp
 *     1710x912 lossy WebP q80: the largest exact 15:8 rectangle centred in the
 *     master (3-4 px trimmed from each side, 2 px from top and bottom), with no
 *     resampling at all, so nothing is warped. It is not a 4:1 World Location or
 *     Local Place scene: Hilltop Workshop's approved panorama and map identifier
 *     are unchanged.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-wise-old-enby-art.mjs
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
const PORTRAITS = [
  {
    expression: "neutral",
    sha256: "eca3c7f8595ea9f65a712bb0114fa8045dfabcdf38debeeab7180dd42a9aa827",
  },
  {
    expression: "friendly",
    sha256: "668a7776f3f894dfc082001b58d38f954c1aa4a168885960becf1472719d98ea",
  },
  {
    expression: "thoughtful",
    sha256: "c4755d09b6be76cef331f09a022fd728c38b01c4db66f29338a011b22113e323",
  },
  {
    expression: "amused",
    sha256: "21503b65f0cc72337d9ba6d99f825ab5fbb0a41f78bc1415c5627eb87beb7559",
  },
];
const PORTRAIT_MASTER_SIZE = { width: 1122, height: 1402 };

const INTERIOR = {
  master: "hilltop-workshop-dialogue-interior-master.png",
  sha256: "e98599a6c092df0185119760ef31b888639a501fe3d51dd6694ab04e31782b88",
  masterSize: { width: 1717, height: 916 },
  out: "hilltop-workshop-interior.webp",
  outSize: { width: 1710, height: 912 },
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

for (const portrait of PORTRAITS) {
  const masterPath = join(
    repoRoot,
    "assets/npc-art/wise-old-enby",
    `wise-old-enby-${portrait.expression}-master.png`,
  );
  const outPath = join(repoRoot, "public/npc-art", `wise-old-enby-${portrait.expression}.png`);
  await verifiedMaster(masterPath, portrait.sha256, PORTRAIT_MASTER_SIZE);
  // Height-led so the scale is one uniform factor; the rounded width is checked.
  await sharp(masterPath)
    .resize({ height: PORTRAIT.height, kernel: "lanczos3" })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath);
  const out = await sharp(outPath).metadata();
  if (out.width !== PORTRAIT.width || out.height !== PORTRAIT.height || !out.hasAlpha) {
    throw new Error(`${outPath} must be a ${PORTRAIT.width}x${PORTRAIT.height} RGBA portrait`);
  }
  console.log(`${outPath} ${out.width}x${out.height} ${statSync(outPath).size} bytes`);
}

const interiorMaster = join(repoRoot, "assets/location-scenes", INTERIOR.master);
const interiorOut = join(repoRoot, "public/location-scenes", INTERIOR.out);
await verifiedMaster(interiorMaster, INTERIOR.sha256, INTERIOR.masterSize);
if (INTERIOR.outSize.width * 8 !== INTERIOR.outSize.height * 15) {
  throw new Error(`${INTERIOR.out} must be exactly 15:8`);
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
console.log(
  `${interiorOut} ${INTERIOR.outSize.width}x${INTERIOR.outSize.height} ${statSync(interiorOut).size} bytes`,
);
