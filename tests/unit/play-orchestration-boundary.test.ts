import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Structural ownership proof for Issue #127: the generic play orchestration
 * boundary must not be Mining-owned, and no non-Mining feature may depend on
 * Mining-named generic play APIs.
 *
 * These are fast, DB-free assertions over the source tree.
 */

const SERVER_PLAY = readFileSync("server/play.ts", "utf8");
const SERVER_MINING = readFileSync("server/mining.ts", "utf8");
const SERVER_REFINING = readFileSync("server/refining.ts", "utf8");
const SERVER_MINING_COMMANDS = readFileSync("server/mining-commands.ts", "utf8");
const SERVER_REFINING_COMMANDS = readFileSync("server/refining-commands.ts", "utf8");
const SERVER_ACTIONS = readFileSync("server/actions.ts", "utf8");

const NON_MINING_FEATURE_DIRS = [
  "features/refining",
  "features/travel",
  "features/npc",
  "features/cargo",
  "features/power-annex",
  "features/missions",
];

function collectFeatureSources(dirs: string[]): string[] {
  const { readdirSync, statSync } = require("node:fs");
  const { join } = require("node:path");
  const out: string[] = [];
  for (const dir of dirs) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isFile() && /\.(ts|tsx)$/.test(entry))
        out.push(readFileSync(full, "utf8"));
    }
  }
  return out;
}

const NON_MINING_SOURCES = collectFeatureSources(NON_MINING_FEATURE_DIRS);

describe("server play orchestration ownership (#127)", () => {
  it("server/play.ts owns the generic play orchestration exports", () => {
    for (const symbol of [
      "createPlayResolver",
      "stateFromTransaction",
      "PlayGameplayState",
      "ActivityStop",
      "CargoHoldState",
      "ScavengeResolvedOutcome",
      "getPlayGameplayState",
      "ensurePlayProvisioning",
    ]) {
      const isType =
        symbol === "PlayGameplayState" ||
        symbol === "ActivityStop" ||
        symbol === "CargoHoldState" ||
        symbol === "ScavengeResolvedOutcome";
      expect(
        SERVER_PLAY.includes(`export ${isType ? "type" : "function"} ${symbol}`) ||
          SERVER_PLAY.includes(`export async function ${symbol}`),
      ).toBe(true);
    }
  });

  it("server/play.ts only imports createMiningResolver + defaultMiningRandom from mining", () => {
    const miningImports = SERVER_PLAY.match(/from "@\/server\/mining"/g) ?? [];
    expect(miningImports.length).toBe(1);
    // The only mining import block should contain createMiningResolver + defaultMiningRandom
    const block = SERVER_PLAY.slice(SERVER_PLAY.indexOf('from "@/server/mining"') - 200);
    expect(block).toContain("createMiningResolver");
    expect(block).toContain("defaultMiningRandom");
  });

  it("server/mining.ts no longer exports generic play symbols", () => {
    for (const symbol of [
      "MiningGameplayState",
      "createPlayResolver",
      "stateFromTransaction",
      "getMiningGameplayState",
      "beginTravel",
      "claimScavenge",
      "acknowledgeScavengeReveal",
      "startFerriteShaleMining",
      "stopMining",
      "loadSalvageCutterPowerCell",
      "startRefining",
      "stopRefining",
      "RefiningRunAttempt",
      "RefiningRunState",
      "ensureStarterMiningState",
      "defaultRefiningRandom",
      "e2eRefiningRandom",
    ]) {
      expect(SERVER_MINING).not.toContain(`export ${symbol}`);
    }
  });

  it("cycle guards: mining.ts and refining.ts never import server/play.ts", () => {
    expect(SERVER_MINING).not.toContain('from "@/server/play"');
    expect(SERVER_REFINING).not.toContain('from "@/server/play"');
  });

  it("leaf command modules may depend on both owner and play, and nothing imports them", () => {
    // mining-commands depends on mining + play (both allowed leaf edges)
    expect(SERVER_MINING_COMMANDS).toContain('from "@/server/mining"');
    expect(SERVER_MINING_COMMANDS).toContain('from "@/server/play"');
    // refining-commands depends on refining + play (both allowed leaf edges)
    expect(SERVER_REFINING_COMMANDS).toContain('from "@/server/refining"');
    expect(SERVER_REFINING_COMMANDS).toContain('from "@/server/play"');
  });

  it("Refining RNG is owned by server/refining.ts, not mining.ts", () => {
    expect(SERVER_REFINING).toContain("export function e2eRefiningRandom");
    expect(SERVER_REFINING).toContain("export function defaultRefiningRandom");
    expect(SERVER_MINING).not.toContain("defaultRefiningRandom");
    expect(SERVER_MINING).not.toContain("e2eRefiningRandom");
  });

  it("ensureStarterMiningState is gone repo-wide", () => {
    const { execSync } = require("node:child_process");
    const grep = execSync(
      "grep -rn ensureStarterMiningState --include='*.ts' --include='*.tsx' app/ server/ features/ tests/ --exclude='play-orchestration-boundary.test.ts' || true",
      { encoding: "utf8" },
    );
    expect(grep.trim()).toBe("");
  });

  it("generic server action names are feature-neutral", () => {
    expect(SERVER_ACTIONS).toContain("export type PlayActionResult");
    expect(SERVER_ACTIONS).toContain("refreshPlayAction");
    // start/stopMiningAction remain Mining-named (they are Mining)
    expect(SERVER_ACTIONS).toContain("export async function startMiningAction");
    expect(SERVER_ACTIONS).toContain("export async function stopMiningAction");
    // no MiningActionResult / runMiningAction / refreshMiningAction remain
    expect(SERVER_ACTIONS).not.toContain("MiningActionResult");
    expect(SERVER_ACTIONS).not.toContain("runMiningAction");
    expect(SERVER_ACTIONS).not.toContain("refreshMiningAction");
  });
});

describe("client play shell ownership (#127)", () => {
  it("the route-level play shell is no longer Mining-owned", () => {
    const page = readFileSync("app/play/[characterId]/page.tsx", "utf8");
    expect(page).toContain('from "@/features/play/PlayScreen"');
    expect(page).not.toContain("MiningPlayScreen");
    expect(page).not.toContain("MiningConsole");
  });

  it("features/play exposes PlayProvider/usePlay and features/mining no longer has the old shell", () => {
    const ctx = readFileSync("features/play/PlayContext.tsx", "utf8");
    expect(ctx).toContain("export function PlayProvider");
    expect(ctx).toContain("export function usePlay");
    expect(ctx).toContain('from "@/server/play"');
    // old files gone
    const { existsSync } = require("node:fs");
    expect(existsSync("features/mining/MiningPlayScreen.tsx")).toBe(false);
    expect(existsSync("features/mining/MiningConsole.tsx")).toBe(false);
    expect(existsSync("features/mining/MiningPlayContext.tsx")).toBe(false);
    expect(existsSync("features/mining/command-gate.ts")).toBe(false);
    expect(existsSync("features/play/command-gate.ts")).toBe(true);
  });

  it("no non-Mining feature imports MiningPlayContext/useMiningPlay", () => {
    for (const src of NON_MINING_SOURCES) {
      expect(src).not.toContain("useMiningPlay");
      expect(src).not.toContain("MiningPlayContext");
      expect(src).not.toContain('from "@/features/mining/MiningPlayContext"');
    }
  });

  it("no non-Mining module references MiningActionResult/refreshMiningAction/runMiningAction", () => {
    for (const src of NON_MINING_SOURCES) {
      expect(src).not.toContain("MiningActionResult");
      expect(src).not.toContain("refreshMiningAction");
      expect(src).not.toContain("runMiningAction");
    }
  });
});
