import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIALOGUE_IDS } from "@/game/config/foundations";
import { CONVERSATION_TOPICS } from "@/game/content/conversation-topics";
import { MISSIONS } from "@/game/content/missions";

/**
 * The owner's gate for #491: Holo Drive-In ticket purchases are not exposed to players until
 * the Mining and Welding buff effects are implemented.
 *
 * This slice ships the server half (the schedule, the catalog, the receipts, the purchase
 * transaction and the buff balances) and Tamsyn's film-specific dialogue, and none of it is
 * reachable. This file is the proof, and the deliberate gate: it fails if a route, action, page,
 * component or other server module imports the purchase command, and it fails if Tamsyn's
 * "What's showing?" topic is offered in her conversation hub. Her closing lines tell a player
 * the bonus comes with a ticket, which must not be said while no ticket can be bought.
 *
 * The slice that implements the buff effects removes this file in the same change that exposes
 * the purchase and registers the topic, and says so in its description.
 */

const ROOT = process.cwd();
const SHIPPED_DIRECTORIES = ["app", "components", "features", "game", "server", "db", "minigames"];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) found.push(path);
  }
  return found;
}

describe("Holo Drive-In tickets are not yet exposed to players (#491)", () => {
  it("is imported by no shipped surface, route, action or module", () => {
    const importers = SHIPPED_DIRECTORIES.flatMap((directory) => sourceFiles(join(ROOT, directory)))
      .filter((file) => !file.endsWith(join("server", "theatre-commands.ts")))
      .filter((file) =>
        /(?:from|import\()\s*["'][^"']*theatre-commands["']/.test(readFileSync(file, "utf8")),
      )
      .map((file) => file.slice(ROOT.length + 1));
    expect(importers).toEqual([]);
  });

  it("keeps the purchase out of the Play state and every Mission", () => {
    const play = readFileSync(join(ROOT, "server", "play.ts"), "utf8");
    expect(play).not.toMatch(/loadCharacterTheatreState|loadTheatreReceipts|buyTheatreTicket/);
    expect(JSON.stringify(MISSIONS)).not.toMatch(/theatre|ticket/i);
  });

  it("does not offer What's showing? in Tamsyn's hub while no ticket can be bought", () => {
    expect(
      CONVERSATION_TOPICS.filter(
        (topic) => topic.dialogueId === DIALOGUE_IDS.tamsynWhatsShowingTopic,
      ),
    ).toEqual([]);
    expect(
      CONVERSATION_TOPICS.filter((topic) => (topic.label as string) === "What's showing?"),
    ).toEqual([]);
  });
});
