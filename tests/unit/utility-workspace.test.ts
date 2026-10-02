import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import resolveConfig from "tailwindcss/resolveConfig";
import { describe, expect, it } from "vitest";
import tailwindConfig from "@/tailwind.config";
import { GameShell } from "@/components/ui/GameShell";
import { UtilitySurface } from "@/components/ui/UtilitySurface";
import {
  createChatDraftStore,
  EMPTY_CHAT_DRAFT,
  PUBLIC_CHAT_DRAFT_KEY,
  whisperDraftKey,
} from "@/features/chat/chat-drafts";
import { MissionObjectivesRegion } from "@/features/missions/MissionObjectivesRegion";
import { utilityUpdater } from "@/features/play/PlayContext";
import {
  DEFAULT_HOME_UTILITY,
  DESKTOP_WORKSPACE_MIN_WIDTH_PX,
  DESKTOP_WORKSPACE_QUERY,
  dockedUtility,
  homeUtilityStorageKey,
  isPlayUtilityId,
  nextUtilityTab,
  openIntentForTab,
  parseHomeUtility,
  PLAY_UTILITY_IDS,
  PLAY_UTILITY_LABELS,
  type PlayUtilityId,
} from "@/features/play/utility-workspace";
import type { PlayGameplayState } from "@/server/play";

/**
 * Issue #286 — the desktop Play workspace's pure rules and the structural
 * contracts the browser spec relies on. The composition itself is proven in
 * `tests/e2e/desktop-workspace.spec.ts`.
 */

describe("utility identities", () => {
  it("are exactly Chat, Inventory, Character and Missions, in that order", () => {
    expect([...PLAY_UTILITY_IDS]).toEqual(["chat", "inventory", "character", "missions"]);
    expect(PLAY_UTILITY_IDS.map((id) => PLAY_UTILITY_LABELS[id])).toEqual([
      "Chat",
      "Inventory",
      "Character",
      "Missions",
    ]);
  });

  it("never call Missions 'Quests'", () => {
    expect(Object.values(PLAY_UTILITY_LABELS).join(" ")).not.toMatch(/quest/i);
  });

  it("recognises only real utilities", () => {
    expect(isPlayUtilityId("inventory")).toBe(true);
    expect(isPlayUtilityId("quests")).toBe(false);
    expect(isPlayUtilityId(undefined)).toBe(false);
    expect(isPlayUtilityId(3)).toBe(false);
  });
});

describe("the desktop home preference", () => {
  it("is keyed per character", () => {
    expect(homeUtilityStorageKey("a")).not.toBe(homeUtilityStorageKey("b"));
    expect(homeUtilityStorageKey("abc")).toContain("abc");
  });

  it("falls back to Chat for anything missing, stale or unrecognised", () => {
    expect(DEFAULT_HOME_UTILITY).toBe("chat");
    for (const raw of [null, undefined, "", "quests", "CHAT", "{}", "inventory "]) {
      expect(parseHomeUtility(raw)).toBe("chat");
    }
  });

  it("round-trips every utility", () => {
    for (const id of PLAY_UTILITY_IDS) expect(parseHomeUtility(id)).toBe(id);
  });
});

describe("what the dock shows and what a tab press opens", () => {
  it("shows the explicit utility, otherwise the home, and nothing before the home is read", () => {
    expect(dockedUtility("inventory", "chat")).toBe("inventory");
    expect(dockedUtility(undefined, "missions")).toBe("missions");
    expect(dockedUtility(undefined, undefined)).toBeUndefined();
  });

  it("treats choosing the home tab as the passive state, not an explicit open", () => {
    expect(openIntentForTab("chat", "chat")).toBeUndefined();
    expect(openIntentForTab("inventory", "chat")).toBe("inventory");
    expect(openIntentForTab("inventory", "inventory")).toBeUndefined();
  });
});

describe("the tab list's keyboard order", () => {
  it("moves with the arrow keys and wraps at both ends", () => {
    expect(nextUtilityTab("chat", "ArrowRight")).toBe("inventory");
    expect(nextUtilityTab("missions", "ArrowRight")).toBe("chat");
    expect(nextUtilityTab("chat", "ArrowLeft")).toBe("missions");
    expect(nextUtilityTab("character", "ArrowLeft")).toBe("inventory");
  });

  it("jumps to the ends with Home and End and ignores every other key", () => {
    expect(nextUtilityTab("character", "Home")).toBe("chat");
    expect(nextUtilityTab("character", "End")).toBe("missions");
    for (const key of ["Tab", "Enter", " ", "ArrowDown", "a"]) {
      expect(nextUtilityTab("chat", key)).toBeUndefined();
    }
  });
});

describe("the single open intent", () => {
  const open = (utility: PlayUtilityId, action: boolean, current?: PlayUtilityId) =>
    utilityUpdater(utility, action)(current);

  it("opening one utility replaces whichever was open", () => {
    expect(open("inventory", true, "chat")).toBe("inventory");
    expect(open("missions", true, undefined)).toBe("missions");
  });

  it("closing a utility closes only itself", () => {
    expect(open("inventory", false, "inventory")).toBeUndefined();
    // A stale close from a Drawer that was already replaced does not close the new one.
    expect(open("inventory", false, "missions")).toBe("missions");
  });

  it("honours functional updates against that utility's own flag", () => {
    expect(utilityUpdater("character", (was) => !was)("character")).toBeUndefined();
    expect(utilityUpdater("character", (was) => !was)(undefined)).toBe("character");
    expect(utilityUpdater("character", (was) => !was)("chat")).toBe("character");
  });
});

describe("Chat drafts", () => {
  it("are kept and read back, per key", () => {
    const drafts = createChatDraftStore();
    expect(drafts.read(PUBLIC_CHAT_DRAFT_KEY)).toEqual(EMPTY_CHAT_DRAFT);
    drafts.write(PUBLIC_CHAT_DRAFT_KEY, { text: "hello", mentions: [], promote: true });
    drafts.write(whisperDraftKey("peer"), { text: "psst", mentions: [], promote: false });
    expect(drafts.read(PUBLIC_CHAT_DRAFT_KEY).text).toBe("hello");
    expect(drafts.read(PUBLIC_CHAT_DRAFT_KEY).promote).toBe(true);
    expect(drafts.read(whisperDraftKey("peer")).text).toBe("psst");
    expect(drafts.read(whisperDraftKey("other"))).toEqual(EMPTY_CHAT_DRAFT);
  });

  it("spend the draft that was sent, even when the send outlived the surface", () => {
    const drafts = createChatDraftStore();
    drafts.write(PUBLIC_CHAT_DRAFT_KEY, { text: "WTS iron", mentions: [], promote: true });
    drafts.settle(PUBLIC_CHAT_DRAFT_KEY, "WTS iron");
    expect(drafts.read(PUBLIC_CHAT_DRAFT_KEY)).toEqual(EMPTY_CHAT_DRAFT);
  });

  it("leave a draft the player has changed since alone when an older send settles", () => {
    const drafts = createChatDraftStore();
    drafts.write(PUBLIC_CHAT_DRAFT_KEY, { text: "WTS iron, more", mentions: [], promote: false });
    drafts.settle(PUBLIC_CHAT_DRAFT_KEY, "WTS iron");
    expect(drafts.read(PUBLIC_CHAT_DRAFT_KEY).text).toBe("WTS iron, more");
  });

  it("forget a draft that has been sent or cleared", () => {
    const drafts = createChatDraftStore();
    drafts.write(PUBLIC_CHAT_DRAFT_KEY, { text: "hello", mentions: [], promote: false });
    drafts.write(PUBLIC_CHAT_DRAFT_KEY, { text: "", mentions: [], promote: false });
    expect(drafts.read(PUBLIC_CHAT_DRAFT_KEY)).toEqual(EMPTY_CHAT_DRAFT);
  });
});

describe("the 1280px contract", () => {
  it("is one number: the JS query, Tailwind's xl, and the Map panel's media query", () => {
    expect(DESKTOP_WORKSPACE_MIN_WIDTH_PX).toBe(1280);
    expect(DESKTOP_WORKSPACE_QUERY).toBe("(min-width: 1280px)");
    const screens = resolveConfig(tailwindConfig).theme.screens as Record<string, string>;
    expect(screens.xl).toBe(`${DESKTOP_WORKSPACE_MIN_WIDTH_PX}px`);
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(
      new RegExp(
        `@media \\(min-width: ${DESKTOP_WORKSPACE_MIN_WIDTH_PX}px\\)\\s*\\{\\s*\\.rs-map-destination-panel`,
      ),
    );
  });
});

describe("the shell's slots", () => {
  const tokens = (markup: string) =>
    [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1]!.split(/\s+/));

  const shell = (withRail: boolean) =>
    renderToStaticMarkup(
      React.createElement(GameShell, {
        topBar: React.createElement("header", null, "top"),
        bottomNav: React.createElement("span", null, "nav"),
        floatingAction: React.createElement("span", null, "launcher"),
        children: React.createElement("p", null, "main"),
        ...(withRail ? { desktopRail: React.createElement("span", null, "rail") } : {}),
      }),
    );

  it("hides the phone's navigation and launcher at desktop width only when it has a rail", () => {
    const withRail = tokens(shell(true));
    expect(withRail.filter((token) => token === "xl:hidden")).toHaveLength(2);
    expect(withRail).toContain("xl:grid-cols-[minmax(0,1fr)_24rem]");
    expect(withRail).toContain("xl:pb-3");
    const without = tokens(shell(false));
    expect(without).not.toContain("xl:hidden");
    expect(without).not.toContain("xl:grid-cols-[minmax(0,1fr)_24rem]");
  });

  it("renders the rail only from its slot, hidden below xl", () => {
    const markup = shell(true);
    expect(markup).toContain("data-play-rail");
    expect(markup).toContain("rail");
    expect(shell(false)).not.toContain("data-play-rail");
    // Below 1280px neither slot is displayed.
    expect(markup).toMatch(/class="hidden[^"]*xl:flex[^"]*"[^>]*data-play-rail/);
  });

  it("never fuses two utilities into one token", () => {
    // A trailing space inside a class string is trimmed by the class sorter; a
    // concatenation that relied on it once produced "xl:hiddenfixed".
    for (const token of tokens(shell(true))) {
      expect(token).not.toMatch(/xl:hidden[a-z]/);
      expect(token).not.toMatch(/xl:grid-cols-\[[^\]]*\][a-z]/);
    }
  });
});

describe("UtilitySurface docked", () => {
  const docked = renderToStaticMarkup(
    React.createElement(UtilitySurface, {
      presentation: "docked",
      label: "Inventory",
      title: "Inventory",
      eyebrow: "Eyebrow",
      docked: { id: "panel", labelledBy: "tab", actions: React.createElement("i", null, "act") },
      children: React.createElement("p", null, "body"),
    }),
  );

  it("is an ordinary tab-panel region, never a dialog", () => {
    expect(docked).toContain('role="tabpanel"');
    expect(docked).toContain('id="panel"');
    expect(docked).toContain('aria-labelledby="tab"');
    expect(docked).not.toContain("aria-modal");
    expect(docked).not.toContain('role="dialog"');
    expect(docked).toContain("act");
    expect(docked).toContain("body");
  });

  it("scrolls on its own", () => {
    expect(docked).toContain("overflow-y-auto");
  });
});

describe("the objectives region", () => {
  it("renders nothing with no accepted Mission, so no empty box is reserved", () => {
    const state = {
      missions: [{ missionId: "x", state: "completed" }],
    } as unknown as PlayGameplayState;
    expect(renderToStaticMarkup(React.createElement(MissionObjectivesRegion, { state }))).toBe("");
  });
});
