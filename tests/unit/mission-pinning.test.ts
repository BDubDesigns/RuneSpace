import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MissionProjection } from "@/game/domain/missions";
import { MissionGuidanceStrips } from "@/features/missions/MissionGuidanceStrips";
import type { NpcConversationEntry } from "@/game/domain/conversation";
import {
  derivePinnedGuidanceTargets,
  guidancePresentationMissions,
  isMissionPinned,
  pinnedGuidanceMissions,
  presentConversationEntries,
} from "@/features/missions/mission-pins";
import { MissionLogPanel } from "@/features/missions/MissionLogPanel";
import { MissionObjectivesRegion } from "@/features/missions/MissionObjectivesRegion";
import type { PlayGameplayState } from "@/server/play";

vi.mock("@/features/play/PlayContext", () => ({
  usePlay: () => ({ missionsTrigger: { current: null }, openInventory: () => undefined }),
}));
vi.mock("@/server/actions", () => ({}));

/**
 * Mission pinning on the client (#325): which strips Current Missions shows,
 * and the controls that change it. Pinning filters presentation only, so the
 * projections handed in here are never altered by it.
 */

function mission(
  missionId: string,
  title: string,
  state: MissionProjection["state"],
  options: Partial<MissionProjection> = {},
): MissionProjection {
  const accepted = state === "active" || state === "ready_for_completion";
  return {
    missionId,
    title,
    summary: `${title} briefing.`,
    state,
    prerequisiteSatisfied: true,
    ...(accepted
      ? {
          currentObjective: state === "active" ? `Do ${title}` : `Hand in ${title}`,
          requirements: [
            {
              kind: "at_location",
              objective: `Reach the ${title} site`,
              satisfied: state === "ready_for_completion",
            },
          ],
          stage: {
            requirementsSatisfied: state === "ready_for_completion",
            turnInAvailable: false,
          },
        }
      : {}),
    ...options,
  } as MissionProjection;
}

const ALPHA = mission("alpha", "Alpha Job", "active");
const BRAVO = mission("bravo", "Bravo Job", "ready_for_completion");
const DONE = mission("done", "Done Job", "completed", {
  completedAt: new Date("2026-10-01T00:00:00.000Z"),
  earnedReward: { kind: "credits", amount: 5 },
});

function stateOf(missions: MissionProjection[], unpinnedMissionIds: string[] = []) {
  return { missions, unpinnedMissionIds } as unknown as PlayGameplayState;
}

const strips = (state: PlayGameplayState) =>
  renderToStaticMarkup(React.createElement(MissionGuidanceStrips, { state }));

const region = (state: PlayGameplayState) =>
  renderToStaticMarkup(React.createElement(MissionObjectivesRegion, { state }));

function log(state: PlayGameplayState, focusedMissionId?: string) {
  return renderToStaticMarkup(
    React.createElement(MissionLogPanel, {
      state,
      focusedMissionId,
      onClose: () => undefined,
      // Docked: an ordinary region, so it renders without a browser portal.
      presentation: "docked",
      triggerRef: { current: null },
    }),
  );
}

/** The opening tag of the first element carrying `attribute`. */
function tagWith(markup: string, attribute: string) {
  return new RegExp(`<[a-z]+[^>]*${attribute}[^>]*>`).exec(markup)?.[0] ?? "";
}

describe("which Missions Current Missions shows", () => {
  it("treats absence as pinned, so every accepted Mission starts pinned", () => {
    const state = stateOf([ALPHA, BRAVO]);
    expect(isMissionPinned(state, "alpha")).toBe(true);
    expect(pinnedGuidanceMissions(state).map((m) => m.missionId)).toEqual(["alpha", "bravo"]);
  });

  it("drops only the unpinned Mission and keeps the authoritative order", () => {
    const state = stateOf([ALPHA, BRAVO], ["alpha"]);
    expect(pinnedGuidanceMissions(state).map((m) => m.missionId)).toEqual(["bravo"]);
    const markup = strips(state);
    expect(markup).not.toContain('data-mission-strip="alpha"');
    expect(markup).toContain('data-mission-strip="bravo"');
  });

  it("never shows a completed Mission, whatever its old pin preference", () => {
    expect(pinnedGuidanceMissions(stateOf([DONE])).map((m) => m.missionId)).toEqual([]);
    expect(strips(stateOf([DONE]))).toBe("");
  });

  it("renders no placeholder at all once every active Mission is unpinned", () => {
    const state = stateOf([ALPHA, BRAVO], ["alpha", "bravo"]);
    expect(strips(state)).toBe("");
    expect(region(state)).toBe("");
  });

  it("counts only pinned Missions in the desktop region", () => {
    expect(region(stateOf([ALPHA, BRAVO]))).toContain("Current Missions · 2");
    // One pinned Mission is a plain strip, with no collapse header.
    const single = region(stateOf([ALPHA, BRAVO], ["bravo"]));
    expect(single).not.toContain("data-objectives-toggle");
    expect(single).toContain('data-mission-strip="alpha"');
  });
});

describe("the Current Missions Unpin control", () => {
  it("names the Mission it unpins and leaves the strip's phase and objective alone", () => {
    const markup = strips(stateOf([ALPHA, BRAVO]));
    expect(markup).toContain('aria-label="Unpin Alpha Job"');
    expect(markup).toContain('aria-label="Unpin Bravo Job"');
    expect(markup).toContain('data-mission-phase="work"');
    expect(markup).toContain('data-mission-phase="turn_in"');
    expect(markup).toContain("Do Alpha Job");
    // A one-shot action, not a toggle, and never a guidance target.
    const unpin = tagWith(markup, 'data-mission-strip-unpin="alpha"');
    expect(unpin).toContain('type="button"');
    expect(unpin).not.toContain("aria-pressed");
    expect(unpin).not.toContain("data-mission-guidance");
  });
});

describe("the refreshed Mission Log", () => {
  it("offers a Pin toggle on every active Mission, pressed while pinned", () => {
    const markup = log(stateOf([ALPHA, BRAVO], ["bravo"]));
    const alpha = tagWith(markup, 'data-mission-log-pin="alpha"');
    const bravo = tagWith(markup, 'data-mission-log-pin="bravo"');
    expect(alpha).toContain('aria-label="Pin Alpha Job"');
    expect(alpha).toContain('aria-pressed="true"');
    expect(bravo).toContain('aria-label="Pin Bravo Job"');
    expect(bravo).toContain('aria-pressed="false"');
  });

  it("keeps the Pin toggle and phase on a collapsed card, outside its expand control", () => {
    // Alpha is focused, so Bravo renders collapsed.
    const markup = log(stateOf([ALPHA, BRAVO]), "alpha");
    const bravo = markup.slice(markup.indexOf('data-mission-log-entry="bravo"'));
    expect(bravo).toContain('data-mission-log-pin="bravo"');
    expect(bravo).toContain("Turn in");
    expect(bravo).not.toContain("data-mission-log-current");
    // Two sibling buttons, never a button nested inside the expand control.
    const expand = bravo.slice(bravo.indexOf("aria-expanded"));
    expect(expand.indexOf("</button>")).toBeLessThan(expand.indexOf("data-mission-log-pin"));
  });

  it("leads an expanded card with its Current Objective, ahead of the Progress list", () => {
    const markup = log(stateOf([ALPHA]), "alpha");
    const current = markup.indexOf("data-mission-log-current");
    const progress = markup.indexOf("data-mission-log-requirements");
    expect(current).toBeGreaterThan(-1);
    expect(current).toBeLessThan(progress);
    expect(markup).toContain("Current objective");
    expect(markup).toContain("Progress");
    expect(tagWith(markup, "data-mission-log-next")).toContain('data-mission-log-next="objective"');
    expect(markup).toContain("Do Alpha Job");
    // Active Missions never preview a reward.
    expect(markup).not.toContain("data-mission-log-reward");
  });

  it("marks active work green and the turn-in handoff blue on the card", () => {
    const markup = log(stateOf([ALPHA, BRAVO]));
    expect(tagWith(markup, 'data-mission-log-entry="alpha"')).toContain(
      'data-mission-phase="work"',
    );
    expect(tagWith(markup, 'data-mission-log-entry="bravo"')).toContain(
      'data-mission-phase="turn_in"',
    );
  });

  it("gives completed Missions no pin control and no phase", () => {
    const markup = log(stateOf([ALPHA, DONE]), "done");
    const done = markup.slice(markup.indexOf('data-mission-log-section="completed"'));
    expect(done).not.toContain("data-mission-log-pin");
    // The Completed section stays collapsed by default.
    expect(done).not.toContain('data-mission-log-entry="done"');
  });
});

describe("pin-aware guidance selection (#335)", () => {
  const withGuidance = (m: MissionProjection, guidance: MissionProjection["guidance"]) =>
    ({ ...m, guidance }) as MissionProjection;
  const A = withGuidance(ALPHA, { locationId: "site", npcId: "wade" });
  const B = withGuidance(mission("bravo2", "Bravo Two", "active"), { locationId: "site" });
  const T = withGuidance(BRAVO, { npcId: "tansy", turnIn: true });
  const OFFER = withGuidance(mission("offer", "Offer", "not_accepted"), {
    availableNpcIds: ["tansy"],
  });

  it("leaves everything in when nothing is unpinned", () => {
    const s = stateOf([A, B, T, OFFER]);
    expect(guidancePresentationMissions(s)).toHaveLength(4);
  });

  it("drops an unpinned active job's targets and keeps the rest", () => {
    const targets = derivePinnedGuidanceTargets(stateOf([A, T, OFFER], ["alpha"]));
    expect(targets.npcIds.has("wade")).toBe(false);
    expect(targets.locationIds.has("site")).toBe(false);
    expect(targets.turnInNpcIds.has("tansy")).toBe(true);
    expect(targets.availableNpcIds.has("tansy")).toBe(true);
  });

  it("drops an unpinned turn-in job's blue guidance but keeps an independent offer", () => {
    const targets = derivePinnedGuidanceTargets(stateOf([T, OFFER], ["bravo"]));
    expect(targets.turnInNpcIds.size).toBe(0);
    expect(targets.availableNpcIds.has("tansy")).toBe(true);
  });

  it("keeps a shared target until every job sharing it is unpinned", () => {
    const missions = [A, B];
    expect(derivePinnedGuidanceTargets(stateOf(missions, ["alpha"])).locationIds.has("site")).toBe(
      true,
    );
    expect(
      derivePinnedGuidanceTargets(stateOf(missions, ["alpha", "bravo2"])).locationIds.has("site"),
    ).toBe(false);
  });

  it("restores guidance on repin without altering the projections", () => {
    const missions = [A];
    expect(derivePinnedGuidanceTargets(stateOf(missions, ["alpha"])).npcIds.size).toBe(0);
    expect(derivePinnedGuidanceTargets(stateOf(missions)).npcIds.has("wade")).toBe(true);
    expect(missions[0]).toBe(A);
  });

  it("strips only the highlight from an unpinned job's conversation entry", () => {
    const entry = {
      kind: "mission",
      id: "e",
      label: "Alpha Job",
      role: "turn_in",
      roleLabel: "Turn in",
      dialogueId: "d",
      missionId: "alpha",
      guidance: "turn_in",
      action: { kind: "complete_mission", label: "Hand in" },
    } as unknown as NpcConversationEntry;
    const [hidden] = presentConversationEntries(stateOf([A], ["alpha"]), [entry]);
    expect(hidden).toMatchObject({ missionId: "alpha", action: { kind: "complete_mission" } });
    expect("guidance" in hidden!).toBe(false);
    expect(presentConversationEntries(stateOf([A]), [entry])[0]).toBe(entry);
  });
});
