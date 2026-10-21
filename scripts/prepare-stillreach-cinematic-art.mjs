#!/usr/bin/env node
/**
 * Deterministic derivative for the Stillreach flight-cinematic backdrop (issue #375).
 *
 * Input is the owner-approved empty 15:8 master, kept unaltered:
 *   - assets/location-scenes/stillreach-landing-station-cinematic-master.png
 *     1717x916 opaque, SHA-256 7cee91fe78f9fc1cd3979c5a13178185eddaa01136f0c0611133c779cedb143c
 *
 * Output (committed; never regenerated during build or at request time):
 *   - public/location-scenes/stillreach-landing-station-cinematic.webp
 *     1717x916 opaque lossy WebP q80, the same canvas as the first flight's backdrops
 *
 * The master is not resized, cropped, recoloured or regenerated: it is flattened and
 * encoded at its native size, so the approved Rivet placement measured on its 1717x916
 * canvas (game/content/flight-cinematics.ts) holds exactly. It has no ship baked in;
 * the canonical repaired Rivet is composited over it at runtime.
 *
 * `sharp` is Next.js's own image dependency, not a direct one, so it is resolved
 * through `next`.
 *
 * Usage: node scripts/prepare-stillreach-cinematic-art.mjs
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

const MASTER = join(
  repoRoot,
  "assets/location-scenes/stillreach-landing-station-cinematic-master.png",
);
const OUT = join(repoRoot, "public/location-scenes/stillreach-landing-station-cinematic.webp");
const APPROVED_SHA256 = "7cee91fe78f9fc1cd3979c5a13178185eddaa01136f0c0611133c779cedb143c";
const SIZE = { width: 1717, height: 916 };

const digest = createHash("sha256").update(readFileSync(MASTER)).digest("hex");
if (digest !== APPROVED_SHA256) {
  throw new Error(`The cinematic master is not the approved file (sha256 ${digest}).`);
}
const meta = await sharp(MASTER).metadata();
if (meta.width !== SIZE.width || meta.height !== SIZE.height) {
  throw new Error(
    `The cinematic master must be ${SIZE.width}x${SIZE.height}, got ${meta.width}x${meta.height}`,
  );
}
await sharp(MASTER).removeAlpha().webp({ quality: 80, effort: 6 }).toFile(OUT);
console.log(
  `stillreach-landing-station-cinematic.webp ${SIZE.width}x${SIZE.height} ${statSync(OUT).size} bytes`,
);
