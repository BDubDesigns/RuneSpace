import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The in-flight gate (#358). A Rivet in the air blocks every player command at
 * the one shared owned-character boundary, default-deny; only reads and
 * presentation-only dismissals opt out. This keeps that opt-out list exact, so
 * a new command is blocked in flight unless someone decides, here, that it
 * changes no gameplay state.
 */

function sourceFilesUnder(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), root))) {
    const path = join(root, entry);
    if (statSync(join(process.cwd(), path)).isDirectory()) out.push(...sourceFilesUnder(path));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function optOuts(): string[] {
  const found: string[] = [];
  for (const path of ["app", "features", "server"].flatMap((root) => sourceFilesUnder(root))) {
    const source = read(path);
    if (!source.includes("allowDuringFlight: true")) continue;
    for (const match of source.matchAll(/^export async function (\w+)/gm)) {
      const end = source.indexOf("\n}\n", match.index);
      if (source.slice(match.index, end).includes("allowDuringFlight: true")) {
        found.push(`${path}#${match[1]}`);
      }
    }
  }
  return found.sort();
}

describe("in-flight gate", () => {
  it("lets only the Play read and the two presentation dismissals run in flight", () => {
    expect(optOuts()).toEqual([
      "server/play.ts#acknowledgeScavengeReveal",
      "server/play.ts#getPlayGameplayState",
      "server/ship-commands.ts#acknowledgeShipArrival",
    ]);
  });

  it("is enforced by both shared character boundaries, after reconciliation where there is one", () => {
    const source = read("server/action-resolution.ts");
    const resolved = source.slice(
      source.indexOf("export async function withResolvedOwnedCharacter"),
      source.indexOf("export async function withLockedCharacter"),
    );
    const reconcile = resolved.indexOf("reconcileActiveAction(");
    const gate = resolved.indexOf("assertNotInFlight(");
    expect(reconcile).toBeGreaterThan(-1);
    // After reconciliation: a flight whose arrival was due lands first, and the
    // command then runs against the landed ship instead of being refused.
    expect(gate).toBeGreaterThan(reconcile);
    expect(resolved.indexOf("return command(")).toBeGreaterThan(gate);

    const locked = source.slice(
      source.indexOf("export async function withLockedOwnedCharacter"),
      source.indexOf("export async function withResolvedOwnedCharacter"),
    );
    expect(locked).toContain("assertNotInFlight(");
    // The unreconciled boundary reads the action row itself and never lands a flight.
    expect(locked).toContain("activeActions");
    expect(locked).not.toContain("reconcileActiveAction(");
  });

  it("does not exempt the admin boundaries, which an operator uses to inspect, not to play", () => {
    const source = read("server/action-resolution.ts");
    const admin = source.slice(source.indexOf("export async function withLockedCharacter"));
    expect(admin).not.toContain("assertNotInFlight(");
  });
});
