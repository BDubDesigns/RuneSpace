import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #223 — structural inventory of every production entrypoint that can
 * reach player gameplay state, so a new page, route, or server action cannot
 * silently bypass the gameplay-access gate.
 *
 * The gate itself is enforced at two server seams (proved against PostgreSQL
 * in tests/integration/gameplay-access.test.ts):
 * - `server/action-resolution.ts` owned-character lock boundaries, which every
 *   player gameplay command and the Play state load enter;
 * - `requirePlayableOwnedCharacter` for the unlocked gameplay reads.
 * This file keeps the classification exhaustive: every exported player server
 * action and every app page/route must be listed here, and each gameplay
 * entrypoint must use the recovery or gated read it is classified with.
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

/** Exported async functions of a module with their source bodies. */
function exportedFunctionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const matches = source.matchAll(/^export async function (\w+)/gm);
  for (const match of matches) {
    // A top-level function body ends at its first column-zero closing brace.
    const end = source.indexOf("\n}\n", match.index);
    bodies.set(match[1]!, source.slice(match.index, end === -1 ? source.length : end + 2));
  }
  return bodies;
}

/**
 * Player server actions that are account/character management, NOT gameplay,
 * and therefore stay available while public gameplay is closed.
 */
const ACCOUNT_MANAGEMENT_ACTIONS: Record<string, string> = {
  createCharacterAction: "character reservation (verified email required)",
  changeCharacterPortraitAction: "pre-game character presentation",
  acknowledgeNewsAction: "account-level Update news",
  // #248: a suspended player must still be able to appeal.
  submitModerationAppealAction: "moderation appeal on the player's own account",
};

/** Every page and route handler, classified. */
const APP_ENTRYPOINTS: Record<string, string> = {
  "app/page.tsx": "public landing (reads only the public launch state)",
  "app/sign-in/page.tsx": "account: sign-in",
  "app/register/page.tsx": "account: registration",
  "app/characters/page.tsx": "account: Characters experience",
  "app/characters/new/page.tsx": "account: character reservation",
  "app/play/[characterId]/page.tsx": "GAMEPLAY: Play page",
  "app/updates/page.tsx": "public Updates",
  "app/updates/[slug]/page.tsx": "public Updates",
  "app/wiki/page.tsx": "public Wiki",
  "app/wiki/[...slug]/page.tsx": "public Wiki",
  "app/admin/page.tsx": "operator (requireAdmin); never player gameplay",
  "app/admin/characters/page.tsx": "operator (requireAdmin); never player gameplay",
  "app/admin/characters/[characterId]/page.tsx": "operator (requireAdmin); never player gameplay",
  "app/design-system/page.tsx": "dev reference (404 in production)",
  "app/qc-studio/page.tsx": "dev tool (env-gated)",
  "app/api/auth/[...all]/route.ts": "account: Better Auth handler",
  "app/api/build-info/route.ts": "public build identity",
  "app/api/diagnostics/route.ts": "client diagnostics intake",
  "app/api/e2e/turnstile-siteverify/route.ts": "local E2E stub (404 outside the gate)",
  "app/api/location-population/route.ts": "GAMEPLAY: location population read",
  "app/api/character-profile/route.ts": "GAMEPLAY: same-location profile read",
  "app/api/realtime/route.ts": "GAMEPLAY: realtime/social stream (#245)",
  "app/api/e2e/realtime/route.ts": "local E2E hook (404 outside the gate)",
  "app/api/chat/route.ts": "GAMEPLAY: public chat history read (#246)",
  "app/api/chat/mentions/route.ts": "GAMEPLAY: public @mention attention read (#261)",
  "app/api/whispers/route.ts": "GAMEPLAY: Whisper inbox read (#247)",
  "app/api/whispers/conversation/route.ts": "GAMEPLAY: Whisper conversation read (#247)",
  "app/api/blocked-players/route.ts": "GAMEPLAY: Blocked Players read (#247)",
  "app/api/system-notices/route.ts": "GAMEPLAY: System conversation read (#274)",
  "app/api/trade/route.ts": "GAMEPLAY: trade request/session read (#266)",
  // #248 — a suspended player must still reach their notice and appeal.
  "app/moderation/page.tsx": "account: the player's own moderation notices",
  "app/moderation/[sanctionId]/page.tsx": "account: one notice and its appeal",
  "app/api/moderation-notices/route.ts": "account: the player's own moderation notices",
  "app/admin/moderation/page.tsx": "operator (requireAdmin); audited moderation queue",
  "app/admin/moderation/[caseId]/page.tsx": "operator (requireAdmin); audited case review",
  "app/admin/moderation/access-log/page.tsx": "operator (requireAdmin); audited access log",
};

describe("player server actions (server/actions.ts)", () => {
  const source = read("server/actions.ts");
  const bodies = exportedFunctionBodies(source);

  it("enumerates exactly the 81 production player actions", () => {
    // #232 adds nine: Fabrication's start, finish-current, Override toggle,
    // push and Lock In, and Tinkering's start, stop, finish-current and
    // Auto-discard Scrap preference. #246 adds the chat send and promoted ad.
    // #247 adds Whisper open, send, and read, Block, Unblock, and the two
    // Reports. #248 adds the moderation appeal (account management). #266 adds
    // trade request create, cancel, decline, accept, and session cancel. #267
    // adds the trade offer's Credits, stack add/remove, item add/remove,
    // Ready, Change Offer, and Confirm. #274 adds the System conversation read.
    // #261 adds the public mention read and Whisper conversation hide. #284
    // adds seven site stash commands: stack and item deposit and withdrawal,
    // and container install, swap, and remove. #312 adds Turn Back from a
    // Journey. #325 adds Mission pinning.
    expect(bodies.size).toBe(81);
  });

  it("classifies every export as gameplay or named account management", () => {
    const gameplay = [...bodies.keys()].filter((name) => !(name in ACCOUNT_MANAGEMENT_ACTIONS));
    expect(gameplay).toHaveLength(77);
    for (const name of Object.keys(ACCOUNT_MANAGEMENT_ACTIONS)) {
      expect(bodies.has(name), `unknown account action ${name}`).toBe(true);
    }
  });

  it("routes every gameplay action through the stale-page recovery", () => {
    for (const [name, body] of bodies) {
      if (name in ACCOUNT_MANAGEMENT_ACTIONS) {
        expect(body, `${name} is account management`).not.toContain("redirectOnGameplayRefusal");
        continue;
      }
      const recovers =
        body.includes("redirectOnGameplayRefusal(error)") ||
        body.includes("runPlayAction(") ||
        body.includes("runEquipmentAction(") ||
        body.includes("runTradeRequestCommand(") ||
        body.includes("runTradeOfferAction(") ||
        body.includes("runSiteStashAction(");
      expect(recovers, `${name} must recover from a gameplay refusal`).toBe(true);
    }
    for (const helper of [
      "async function runPlayAction",
      "async function runEquipmentAction",
      "async function runTradeRequestCommand",
      "async function runTradeOfferAction",
      "async function runSiteStashAction",
    ]) {
      const start = source.indexOf(helper);
      const body = source.slice(start, source.indexOf("\n}\n", start));
      expect(body, helper).toContain("redirectOnGameplayRefusal(error)");
    }
  });

  it("decides the reservation redirect from authoritative access state", () => {
    const body = bodies.get("createCharacterAction")!;
    expect(body).toContain("requireVerifiedUser(");
    expect(body).toContain("loadAccountGameplayAccess(");
    expect(body).toContain('access.decision.allowed ? `/play/${character.id}` : "/characters"');
  });
});

describe("server action modules", () => {
  it("has exactly the player and operator server-action modules", () => {
    const modules = ["app", "features", "server", "components"]
      .flatMap((root) => sourceFilesUnder(root))
      .filter((path) => /^\s*["']use server["']/m.test(read(path)));
    expect(modules.sort()).toEqual([
      "server/actions.ts",
      "server/admin-actions.ts",
      "server/moderation-actions.ts",
    ]);
  });
});

describe("app pages and route handlers", () => {
  const entrypoints = sourceFilesUnder("app").filter(
    (path) => path.endsWith("/page.tsx") || path.endsWith("/route.ts"),
  );

  it("classifies every page and route", () => {
    expect(entrypoints.sort()).toEqual(Object.keys(APP_ENTRYPOINTS).sort());
  });

  it("guards the Play page with the gated owned-character read", () => {
    const page = read("app/play/[characterId]/page.tsx");
    expect(page).toContain("requirePlayableOwnedCharacter(");
    expect(page).toContain('if (err instanceof OwnershipError) redirect("/characters")');
  });

  it("guards every gameplay read and reports the refusal code", () => {
    for (const [route, server] of [
      ["app/api/location-population/route.ts", "server/location-population.ts"],
      ["app/api/character-profile/route.ts", "server/character-profile.ts"],
      ["app/api/realtime/route.ts", "server/realtime-stream.ts"],
      ["app/api/chat/route.ts", "server/chat.ts"],
      ["app/api/chat/mentions/route.ts", "server/chat.ts"],
      ["app/api/trade/route.ts", "server/player-trades.ts"],
      ["app/api/system-notices/route.ts", "server/system-notices.ts"],
    ] as const) {
      expect(read(server)).toContain("requirePlayableOwnedCharacter(");
      expect(read(route)).toContain("error instanceof GameplayAccessError");
    }
  });

  it("keeps the moderation pages account-scoped and the operator pages admin-only", () => {
    // A suspended player reaches their notice with only a session: never the
    // gameplay gate, and only their own account's sanctions.
    for (const page of ["app/moderation/page.tsx", "app/moderation/[sanctionId]/page.tsx"]) {
      expect(read(page), page).not.toContain("requirePlayableOwnedCharacter(");
    }
    expect(read("server/moderation-notices.ts")).toContain("requirePlayerAccount(userId)");
    for (const page of [
      "app/admin/moderation/page.tsx",
      "app/admin/moderation/[caseId]/page.tsx",
      "app/admin/moderation/access-log/page.tsx",
    ]) {
      expect(read(page), page).toContain("authorizeAdminPage(");
    }
  });

  it("keeps every local E2E hook behind the runtime gate", () => {
    for (const route of entrypoints.filter((path) => path.startsWith("app/api/e2e/"))) {
      expect(read(route), route).toContain("if (!isLocalE2eRuntime())");
    }
  });
});

describe("the gameplay-access seams", () => {
  it("both owned-character lock boundaries require gameplay access before locking", () => {
    const source = read("server/action-resolution.ts");
    // Both enter through one shared helper (#266 added the trade gate to it).
    for (const boundary of ["withLockedOwnedCharacter", "withResolvedOwnedCharacter"]) {
      const start = source.indexOf(`export async function ${boundary}`);
      const body = source.slice(start, source.indexOf("\n}\n", start));
      expect(body, boundary).toContain("lockPlayableOwnedCharacter(");
    }
    const start = source.indexOf("async function lockPlayableOwnedCharacter");
    const body = source.slice(start, source.indexOf("\n}\n", start));
    const gate = body.indexOf("resolvePlayableAccountId(transaction, userId)");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf("lockCharacterRow("));
    expect(source).toContain("return requireGameplayAccess(transaction, userId);");
  });

  it("keeps the rule in one place: only the access boundary evaluates it", () => {
    const callers = ["app", "features", "server", "components"]
      .flatMap((root) => sourceFilesUnder(root))
      .filter((path) => read(path).includes("decideGameplayAccess("));
    expect(callers).toEqual(["server/gameplay-access.ts"]);
  });

  it("leaves no ungated owned-character read helper behind", () => {
    const offenders = ["app", "features", "server"]
      .flatMap((root) => sourceFilesUnder(root))
      .filter((path) => read(path).includes("requireOwnedCharacter("));
    expect(offenders).toEqual([]);
  });
});
