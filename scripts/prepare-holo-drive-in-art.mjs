#!/usr/bin/env node
/**
 * Deterministic derivatives for the Holo Drive-In (issue #491): the seven owner-approved
 * masters from the handoff ZIP (RuneSpace_Holo_Drive_In_Approved_Art_7_Images.zip).
 *
 * Inputs are kept unaltered under assets/ and checked against the SHA-256 of the files
 * the owner handed off (the ZIP's own SHA256SUMS.txt), so a substituted or edited master
 * is refused:
 *   - assets/npc-art/tamsyn-suzara/tamsyn-suzara-{neutral,welcoming,amused,wistful}-master.png
 *     transparent RGBA portraits, about 1087x1447 (the four canvases differ by a pixel
 *     or two)
 *   - assets/location-scenes/holo-drive-in-master.png
 *     2508x627 opaque RGB, the 4:1 World Location exterior
 *   - assets/location-scenes/holo-drive-in-concessions-master.png
 *     1665x888 opaque RGB, the empty concession stand composed for the 15:8 DialogueScene
 *   - assets/map-icons/holo-drive-in.png
 *     1254x1254 grayscale RGBA direct-alpha identifier
 *
 * Outputs (committed; never regenerated during build or at request time):
 *   - public/npc-art/tamsyn-suzara-{expression}.png
 *     400x500 transparent PNG. The four masters are not one canvas size, so a single
 *     scale (the neutral master's 500/1448) is applied to all of them: the same figure
 *     size in every expression. Each is centred horizontally and seated on the bottom
 *     edge of one shared transparent 400x500 canvas, because every figure runs off the
 *     bottom of its master (head to mid-thigh). The four expressions switch in place.
 *     Never cropped, recoloured or stretched.
 *   - public/location-scenes/holo-drive-in.webp
 *     1536x384 opaque lossy WebP q80, downsampled whole (never upscaled).
 *   - public/location-scenes/holo-drive-in-concessions.webp
 *     1665x888 lossy WebP q80: the master is already exactly 15:8, so there is no crop
 *     and no resampling at all.
 *   - public/map-icons/holo-drive-in.webp
 *     Trimmed grayscale lossless WebP, 512 px long edge, by the direct-alpha recipe in
 *     docs/art-cookbook.md: alpha under 4 cleared, near-opaque alpha (>= 240) snapped
 *     fully opaque, trimmed on its alpha bounds, scaled down, then grayscaled.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-holo-drive-in-art.mjs
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
// One scale for every expression: the neutral master is 1448 px tall.
const PORTRAIT_SCALE = PORTRAIT.height / 1448;
const PORTRAITS = [
  {
    expression: "neutral",
    sha256: "e0b034a366b005aa95c1036397b875959b7c9dd9fa30359c248449d6f029965b",
    masterSize: { width: 1086, height: 1448 },
  },
  {
    expression: "welcoming",
    sha256: "3e3fa5f4eaf43fef0cb99745a27d45ca5674cf76cf02c8490bf93b1286fc6d01",
    masterSize: { width: 1087, height: 1447 },
  },
  {
    expression: "amused",
    sha256: "4b285e58e92046739cc782bf00ff1095126ad590f6213f855893e2105d462404",
    masterSize: { width: 1087, height: 1446 },
  },
  {
    expression: "wistful",
    sha256: "6e1671e17b1f945a4da84f86654ef0f1aa99940f04a1607b77ecf1a0dc023256",
    masterSize: { width: 1088, height: 1446 },
  },
];

const EXTERIOR = {
  master: "assets/location-scenes/holo-drive-in-master.png",
  sha256: "089aaf5faadd37aa67cb6bc9428c7a2180dc363dafe91912d3c35b2a90882e0a",
  masterSize: { width: 2508, height: 627 },
  out: "public/location-scenes/holo-drive-in.webp",
  outSize: { width: 1536, height: 384 },
};

const INTERIOR = {
  master: "assets/location-scenes/holo-drive-in-concessions-master.png",
  sha256: "3c9f2e25fda875f154314b7c16ee1b98a9396f5ad5dfb7d7cfadb7a3733fbe8d",
  masterSize: { width: 1665, height: 888 },
  out: "public/location-scenes/holo-drive-in-concessions.webp",
};

const ICON = {
  master: "assets/map-icons/holo-drive-in.png",
  sha256: "d0710c55331f9fd05a6b28d08eb98a930ec4d70b76d96d2201b53f7fe551b7d9",
  masterSize: { width: 1254, height: 1254 },
  out: "public/map-icons/holo-drive-in.webp",
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
    "assets/npc-art/tamsyn-suzara",
    `tamsyn-suzara-${portrait.expression}-master.png`,
  );
  const outPath = join(repoRoot, "public/npc-art", `tamsyn-suzara-${portrait.expression}.png`);
  await verifiedMaster(masterPath, portrait.sha256, portrait.masterSize);
  const width = Math.round(portrait.masterSize.width * PORTRAIT_SCALE);
  const height = Math.min(PORTRAIT.height, Math.round(portrait.masterSize.height * PORTRAIT_SCALE));
  const scaled = await sharp(masterPath)
    .resize({ width, height, kernel: "lanczos3" })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: PORTRAIT.width,
      height: PORTRAIT.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: scaled,
        left: Math.floor((PORTRAIT.width - width) / 2),
        top: PORTRAIT.height - height,
      },
    ])
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
if (INTERIOR.masterSize.width * 8 !== INTERIOR.masterSize.height * 15) {
  throw new Error("The interior master must already be exactly 15:8");
}
await sharp(interiorMaster).removeAlpha().webp({ quality: 80, effort: 6 }).toFile(interiorOut);
report(interiorOut, INTERIOR.masterSize.width, INTERIOR.masterSize.height);

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
