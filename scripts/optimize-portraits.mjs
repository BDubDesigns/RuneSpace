#!/usr/bin/env node
/**
 * Deterministic repository-side portrait optimization (issue #70).
 *
 * Consumes the single machine-readable catalog (game/content/portrait-catalog.json)
 * and produces, for every accepted portrait:
 *   - public/character-portraits/<canonical>.webp  — 512x512 WebP quality 80
 *     production derivative (the only asset the application consumes);
 *   - docs/assets/portrait-contact-sheet.png       — labeled human-review
 *     evidence built from the committed derivatives, never shipped as a portrait.
 *
 * It uses the already-installed Playwright Chromium (devDependency) as a canvas
 * codec; no new dependency, no runtime image service, and derivatives are
 * committed before CI/deployment — never regenerated during `next build` or at
 * request time. Output is deterministic for the pinned Chromium revision; if a
 * future agent regenerates, they must record the new Playwright/Chromium
 * version and the changed byte sizes in the PR.
 *
 * Usage: node scripts/optimize-portraits.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const catalogPath = join(repoRoot, "game/content/portrait-catalog.json");
const mastersDir = join(repoRoot, "assets/character-portraits");
const derivativesDir = join(repoRoot, "public/character-portraits");
const contactSheetPath = join(repoRoot, "docs/assets/portrait-contact-sheet.png");

const DERIVATIVE_SIZE = 512;
const WEBP_QUALITY = 0.8;
const EXPECTED_MASTER_SIZE = 1254;

const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

if (!Array.isArray(catalog) || catalog.length !== 25) {
  throw new Error(`Expected exactly 25 catalog entries, found ${catalog.length ?? "none"}`);
}

mkdirSync(derivativesDir, { recursive: true });

function derivativeFileName(entry) {
  return entry.derivativePath.split("/").at(-1);
}

async function withPage(fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    return await fn(page);
  } finally {
    await browser.close();
  }
}

const report = [];
const sourceTotal = { bytes: 0, count: 0 };
const derivativeTotal = { bytes: 0, count: 0 };

await withPage(async (page) => {
  for (const entry of catalog) {
    const masterPath = join(repoRoot, entry.masterPath);
    const masterBytes = readFileSync(masterPath);
    const sourceBytes = masterBytes.length;
    const outputPath = join(derivativesDir, derivativeFileName(entry));

    const { width, height, webp } = await page.evaluate(
      async ({ dataUrl, size, quality }) => {
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, 0, 0, size, size);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (!blob) throw new Error("webp encode failed");
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
          webp: Array.from(new Uint8Array(await blob.arrayBuffer())),
        };
      },
      {
        dataUrl: `data:image/png;base64,${masterBytes.toString("base64")}`,
        size: DERIVATIVE_SIZE,
        quality: WEBP_QUALITY,
      },
    );

    if (width !== EXPECTED_MASTER_SIZE || height !== EXPECTED_MASTER_SIZE) {
      throw new Error(
        `${entry.id}: expected ${EXPECTED_MASTER_SIZE}x${EXPECTED_MASTER_SIZE} master, found ${width}x${height}`,
      );
    }
    writeFileSync(outputPath, Buffer.from(webp));
    const derivativeBytes = Buffer.from(webp).length;
    sourceTotal.bytes += sourceBytes;
    sourceTotal.count += 1;
    derivativeTotal.bytes += derivativeBytes;
    derivativeTotal.count += 1;
    report.push({
      id: entry.id,
      file: derivativeFileName(entry),
      sourceBytes,
      derivativeBytes,
      ratio: (derivativeBytes / sourceBytes).toFixed(3),
    });
    console.log(
      `ok ${entry.id.padEnd(34)} ${width}x${height} -> ${DERIVATIVE_SIZE}x${DERIVATIVE_SIZE} ` +
        `${(sourceBytes / 1024).toFixed(0)}KiB -> ${(derivativeBytes / 1024).toFixed(0)}KiB`,
    );
  }
});

// Contact sheet: grid of the committed production derivatives, labeled with
// stable ID and launch category. Review evidence only — never a catalog entry.
const contactRows = await withPage(async (page) => {
  const rows = [];
  for (const entry of catalog) {
    const derivativePath = join(derivativesDir, derivativeFileName(entry));
    const bytes = readFileSync(derivativePath);
    rows.push(
      await page.evaluate(
        async ({ dataUrl }) => {
          const image = new Image();
          image.src = dataUrl;
          await image.decode();
          return { width: image.naturalWidth, height: image.naturalHeight };
        },
        { dataUrl: `data:image/webp;base64,${bytes.toString("base64")}` },
      ),
    );
  }
  return rows;
});

const cols = 5;
const rows = Math.ceil(catalog.length / cols);
const tileWidth = 184;
const tileHeight = 240;
const imageSize = 164;
const padding = 14;
const titleHeight = 40;
const sheetWidth = cols * tileWidth + padding * 2;
const sheetHeight = titleHeight + rows * tileHeight + padding * 2;

const contactSheet = await withPage(async (page) => {
  const starterCount = catalog.filter((entry) => entry.category === "player-starter").length;
  const npcCount = catalog.filter((entry) => entry.category === "npc-only").length;
  const reservedCount = catalog.filter((entry) => entry.category === "reserved").length;
  const title = `RuneSpace character portraits — ${starterCount} player-starter · ${npcCount} npc-only · ${reservedCount} reserved (${catalog.length} accepted)`;
  const labels = catalog.map((entry) => `${entry.displayName}\n${entry.id}\n[${entry.category}]`);
  const contactSheetBytes = await page.evaluate(
    async ({
      catalog,
      labels,
      title,
      cols,
      rows,
      tileWidth,
      tileHeight,
      imageSize,
      padding,
      titleHeight,
      sheetWidth,
      sheetHeight,
    }) => {
      const canvas = document.createElement("canvas");
      canvas.width = sheetWidth;
      canvas.height = sheetHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#101418";
      ctx.fillRect(0, 0, sheetWidth, sheetHeight);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#67e8f9";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(title, sheetWidth / 2, padding);
      for (let index = 0; index < catalog.length; index += 1) {
        const col = index % cols;
        const row = Math.floor(index / cols);
        const x = padding + col * tileWidth;
        const y = titleHeight + padding + row * tileHeight;
        const image = new Image();
        image.src = `data:image/webp;base64,${catalog[index].dataUrl}`;
        await image.decode();
        ctx.drawImage(image, x + (tileWidth - imageSize) / 2, y, imageSize, imageSize);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px sans-serif";
        const labelLines = labels[index].split("\n");
        ctx.fillText(labelLines[0], x + tileWidth / 2, y + imageSize + 6);
        ctx.font = "12px sans-serif";
        ctx.fillStyle = "#9fb3c8";
        ctx.fillText(labelLines[1], x + tileWidth / 2, y + imageSize + 26);
        ctx.fillStyle = "#67e8f9";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(labelLines[2], x + tileWidth / 2, y + imageSize + 44);
      }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("contact sheet encode failed");
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    {
      catalog: catalog.map((entry, index) => ({
        dataUrl: readFileSync(join(derivativesDir, derivativeFileName(entry))).toString("base64"),
      })),
      labels,
      title,
      cols,
      rows,
      tileWidth,
      tileHeight,
      imageSize,
      padding,
      titleHeight,
      sheetWidth,
      sheetHeight,
    },
  );
  return Buffer.from(contactSheetBytes);
});

mkdirSync(dirname(contactSheetPath), { recursive: true });
writeFileSync(contactSheetPath, contactSheet);
console.log(
  `contact sheet -> docs/assets/portrait-contact-sheet.png (${(contactSheet.length / 1024).toFixed(0)}KiB)`,
);

// Guard: every catalog derivative must be exactly the declared dimensions.
const declared = new Set(
  catalog.map(
    (entry) => `${derivativeFileName(entry)}:${entry.derivativeWidth}x${entry.derivativeHeight}`,
  ),
);
for (const file of readdirSync(derivativesDir)) {
  if (file === "README.md") continue;
  const stat = statSync(join(derivativesDir, file));
  const dims = contactRows[catalog.findIndex((e) => derivativeFileName(e) === file)];
  if (!dims || !declared.has(`${file}:${dims.width}x${dims.height}`)) {
    throw new Error(`Unexpected or mismatched derivative on disk: ${file}`);
  }
}

console.log(
  `\nTotals: ${sourceTotal.count} masters ${(sourceTotal.bytes / 1048576).toFixed(1)}MiB -> ` +
    `${derivativeTotal.count} derivatives ${(derivativeTotal.bytes / 1048576).toFixed(2)}MiB ` +
    `(${(100 - (derivativeTotal.bytes / sourceTotal.bytes) * 100).toFixed(1)}% reduction)`,
);
