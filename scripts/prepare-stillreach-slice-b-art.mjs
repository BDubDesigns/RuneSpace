#!/usr/bin/env node
/**
 * Deterministic derivatives for Stillreach Slice B's owner-approved art (issue #375).
 *
 * Inputs are the approved masters, kept unaltered and checked against the SHA-256
 * of the files the owner handed off, so a substituted or edited master is refused:
 *   - assets/location-scenes/stillreach-landing-station-cinematic-master.png
 *     1717x916 opaque, the empty 15:8 flight-cinematic scene
 *   - assets/location-scenes/stillreach-fuel-terminal-master.png
 *     2048x512 opaque, the 4:1 Last Leg Trading fuel terminal Local Place scene
 *
 * Outputs (committed; never regenerated during build or at request time):
 *   - public/location-scenes/stillreach-landing-station-cinematic.webp
 *     1717x916 lossy WebP q80 at native size, the same canvas as the first
 *     flight's backdrops, so the Rivet mark measured on it holds exactly
 *   - public/location-scenes/stillreach-fuel-terminal.webp
 *     1536x384 lossy WebP q80, downsampled (never upscaled) to the proven Local
 *     Place production size exactly as Slice A treated its 2048x512 panorama
 *
 * Nothing is cropped, recoloured or regenerated, and no ship or UI is composited:
 * each scene is flattened and resampled whole, preserving its approved composition.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-stillreach-slice-b-art.mjs
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
    master: "stillreach-landing-station-cinematic-master.png",
    sha256: "7cee91fe78f9fc1cd3979c5a13178185eddaa01136f0c0611133c779cedb143c",
    masterSize: { width: 1717, height: 916 },
    out: "stillreach-landing-station-cinematic.webp",
    outSize: { width: 1717, height: 916 },
  },
  {
    master: "stillreach-fuel-terminal-master.png",
    sha256: "654577e0220e2e554d555445241f901084429cab346dd5856f060e41290ce8c7",
    masterSize: { width: 2048, height: 512 },
    out: "stillreach-fuel-terminal.webp",
    outSize: { width: 1536, height: 384 },
  },
];

for (const scene of SCENES) {
  const masterPath = join(repoRoot, "assets/location-scenes", scene.master);
  const outPath = join(repoRoot, "public/location-scenes", scene.out);
  const digest = createHash("sha256").update(readFileSync(masterPath)).digest("hex");
  if (digest !== scene.sha256) {
    throw new Error(`${scene.master} is not the approved file (sha256 ${digest}).`);
  }
  const meta = await sharp(masterPath).metadata();
  if (meta.width !== scene.masterSize.width || meta.height !== scene.masterSize.height) {
    throw new Error(
      `${scene.master} must be ${scene.masterSize.width}x${scene.masterSize.height}, got ${meta.width}x${meta.height}`,
    );
  }
  if (meta.width < scene.outSize.width) throw new Error(`${scene.master} would be upscaled`);
  let pipeline = sharp(masterPath).removeAlpha();
  if (meta.width !== scene.outSize.width) {
    pipeline = pipeline.resize(scene.outSize.width, scene.outSize.height, { kernel: "lanczos3" });
  }
  await pipeline.webp({ quality: 80, effort: 6 }).toFile(outPath);
  console.log(
    `${scene.out} ${scene.outSize.width}x${scene.outSize.height} ${statSync(outPath).size} bytes`,
  );
}
