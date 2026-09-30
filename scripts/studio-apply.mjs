#!/usr/bin/env node

// Issue #185 — deterministic apply of a reviewed QC Studio dialogue export.
//
// Dry-run is the default and never writes. `--write` makes exactly the planned
// change to game/content/dialogue.ts, then proves it in a fresh process and
// restores the original file if the proof fails.
//
//   pnpm studio:apply export.json            # dry run: target + diff
//   pnpm studio:apply export.json --write    # apply, verify, prescribe checks
//   pbpaste | pnpm studio:apply -            # read the export from stdin
//
// Behaviour and the refusal contract are documented in docs/qc-studio.md
// ("Applying QC Studio exports").

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_FILE = path.join(ROOT, "game", "content", "dialogue.ts");

// The game modules use the `@/` path alias and extensionless relative imports,
// which the TypeScript build resolves and bare Node does not (same shim as
// scripts/economy-audit-186.mjs). It lets this script read the real catalog.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = specifier.startsWith("@/")
      ? pathToFileURL(path.join(ROOT, specifier.slice(2))).href
      : specifier;
    try {
      return nextResolve(mapped, context);
    } catch (error) {
      if (mapped.endsWith(".ts")) throw error;
      return nextResolve(`${mapped}.ts`, context);
    }
  },
});

const { DIALOGUE_SEQUENCES } = await import("@/game/content/dialogue");

/** The authoritative catalog as this process loaded it. */
function catalogJson() {
  return JSON.stringify(DIALOGUE_SEQUENCES);
}

const args = process.argv.slice(2);

// Internal: a child process prints the catalog it resolves from the (possibly
// just-edited) source, so the parent can verify the write against a fresh load.
if (args[0] === "--print-catalog") {
  process.stdout.write(catalogJson());
  process.exit(0);
}

const write = args.includes("--write");
const positional = args.filter((arg) => arg !== "--write");
const unknownFlags = positional.filter((arg) => arg.startsWith("-") && arg !== "-");
if (unknownFlags.length > 0 || positional.length !== 1) {
  console.error(
    `${unknownFlags.length > 0 ? `Unknown option ${unknownFlags[0]}. ` : ""}Usage: pnpm studio:apply <export.json | -> [--write]`,
  );
  process.exit(64);
}

const { applyDialogueExport, ApplyRefusal, RUNESPACE_SOURCE_CONSTANTS } = await import(
  "@/tools/qc-studio/adapters/runespace/dialogue-apply"
);
const { runespaceDialogueAdapter } = await import(
  "@/tools/qc-studio/adapters/runespace/dialogue-adapter"
);

function readExport(source) {
  return readFileSync(source === "-" ? 0 : path.resolve(source), "utf8");
}

const io = {
  readSource: () => readFileSync(SOURCE_FILE, "utf8"),
  writeSource: (text) => writeFileSync(SOURCE_FILE, text),
  currentCatalog: catalogJson,
  catalogAfterWrite() {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), "--print-catalog"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (child.status !== 0) throw new Error(child.stderr || `exit ${child.status}`);
    return child.stdout;
  },
};

try {
  const exportText = readExport(positional[0]);
  const { plan, written } = await applyDialogueExport(
    {
      exportText,
      mode: write ? "write" : "dry-run",
      sourceFileName: SOURCE_FILE,
      adapter: runespaceDialogueAdapter,
      constants: RUNESPACE_SOURCE_CONSTANTS,
    },
    io,
  );

  console.log(`Target: ${plan.sequenceId} (game/content/dialogue.ts)`);
  for (const ignored of plan.ignored) console.log(`Ignored: ${ignored}`);
  if (plan.status === "unchanged") {
    console.log("No change: the authoritative sequence already matches this export.");
  } else {
    console.log(`\nProposed change (${plan.changes.length}):`);
    for (const change of plan.changes) console.log(`  ${change}`);
    console.log(`\n${plan.diff}\n`);
    if (written) {
      console.log("Written and verified: a fresh load resolves the target to exactly the export.");
      console.log(
        "Next: pnpm typecheck && pnpm format:check && pnpm test:studio (and pnpm test for content tests).",
      );
    } else {
      console.log("Dry run: no file was changed. Re-run with --write to apply.");
    }
  }
} catch (error) {
  if (error instanceof ApplyRefusal) {
    console.error("Refused; no file was changed.");
    for (const reason of error.reasons) console.error(`  - ${reason}`);
    process.exit(1);
  }
  throw error;
}
