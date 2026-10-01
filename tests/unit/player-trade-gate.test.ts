import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #266 — the accepted-trade gate is deny-by-default inside the shared
 * owned-character lock boundaries. This keeps the opt-outs exact: only reads
 * and presentation-only dismissals may run while a character is
 * trade-engaged, and the gate runs under the row lock, before reconciliation.
 * Behaviour is proved against PostgreSQL in tests/integration/player-trade.test.ts.
 */

function sourceFilesUnder(root: string, out: string[] = []): string[] {
  const abs = join(process.cwd(), root);
  if (!statSync(abs, { throwIfNoEntry: false })) return out;
  for (const entry of readdirSync(abs)) {
    const rel = join(root, entry);
    if (statSync(join(process.cwd(), rel)).isDirectory()) sourceFilesUnder(rel, out);
    else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** Each exported function whose body opts out of the gate, by module. */
function optOuts(): string[] {
  const found: string[] = [];
  for (const path of ["app", "features", "server"].flatMap((root) => sourceFilesUnder(root))) {
    const source = read(path);
    if (!source.includes("allowDuringTrade: true")) continue;
    for (const match of source.matchAll(/^export async function (\w+)/gm)) {
      const end = source.indexOf("\n}\n", match.index);
      if (source.slice(match.index, end).includes("allowDuringTrade: true")) {
        found.push(`${path}#${match[1]}`);
      }
    }
  }
  return found.sort();
}

describe("accepted-trade gate", () => {
  it("lets only the Play read and the Scavenge reveal dismissal run during a trade", () => {
    expect(optOuts()).toEqual([
      "server/play.ts#acknowledgeScavengeReveal",
      "server/play.ts#getPlayGameplayState",
    ]);
  });

  it("checks under the row lock and before any reconciliation", () => {
    const source = read("server/action-resolution.ts");
    const start = source.indexOf("async function lockPlayableOwnedCharacter");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    const lock = body.indexOf("lockCharacterRow(");
    const gate = body.indexOf("assertNotTradeEngaged(");
    expect(lock).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(lock);

    const resolved = source.slice(
      source.indexOf("export async function withResolvedOwnedCharacter"),
    );
    expect(resolved.indexOf("lockPlayableOwnedCharacter(")).toBeLessThan(
      resolved.indexOf("reconcileActiveAction("),
    );
  });

  it("gates the promoted Trade ad, the one Credit spend outside the boundary", () => {
    const source = read("server/chat.ts");
    const charge = source.indexOf("promotedPriceCredits = CHAT_POLICY.promotedAd.priceCredits");
    const gate = source.indexOf("assertNotTradeEngaged(tx, character.id, now)");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(charge);
  });
});
