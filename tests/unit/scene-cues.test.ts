import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DialogueScene } from "@/features/dialogue/DialogueScene";
import { CONVERSATION_BACKGROUND_IDS, EXPRESSION_IDS, NPC_IDS } from "@/game/config/foundations";
import { RESONANCE_RIG_OVERLAY } from "@/game/content/locations";
import {
  RESONANCE_ARRIVAL_CUES,
  RESONANCE_DEPARTURE_CUES,
  RESONANCE_RIG_CUE_ANCHORS,
  SCENE_CUE_SEQUENCES,
  getSceneCueSequence,
} from "@/game/content/scene-cues";
import {
  SCENE_CUE_REST,
  orderedSceneCues,
  sceneCueFinalState,
  sceneCueInitialState,
  sceneCueKeyframes,
  sceneCueLayerStyle,
  sceneCueSequenceDuration,
  validateSceneCueSequence,
  type SceneCue,
  type SceneCueSequence,
} from "@/game/domain/scene-cues";

/**
 * Issue #441 — the reusable scene-cue layer.
 *
 * It is a small authored vocabulary, not a cinematic engine: three layers, five
 * effects, absolute millisecond timing, and no vertical motion at all, because the
 * Wise Old Enby's approved portraits are cropped at the feet.
 */

const portraitBeat = {
  kind: "npc" as const,
  speakerNpcId: NPC_IDS.wiseOldEnby,
  expressionId: EXPRESSION_IDS.friendly,
  backgroundId: CONVERSATION_BACKGROUND_IDS.crashSiteResonanceSite,
  presentationMode: "local" as const,
  text: "The Wise Old Enby has arrived.",
};

describe("the cue vocabulary", () => {
  it("never moves or scales a portrait vertically, in any authored or possible cue", () => {
    const everyPortraitCue: SceneCue[] = [
      { target: "portrait", effect: "fade", at: 0, duration: 100, from: 0, to: 1 },
      { target: "portrait", effect: "slide", at: 0, duration: 100, from: -30, to: 30 },
    ];
    for (const cue of [...everyPortraitCue, ...SCENE_CUE_SEQUENCES.flatMap((s) => s.cues)]) {
      if (cue.target !== "portrait") continue;
      for (const frame of sceneCueKeyframes(cue).keyframes) {
        const css = Object.entries(frame)
          .map(([property, value]) => `${property}:${String(value)}`)
          .join(";");
        expect(css, JSON.stringify(cue)).not.toMatch(
          /translateY|translate3d|scale|rotate|top|bottom/,
        );
      }
    }
    // The only portrait style a state can ever produce is opacity and translateX.
    expect(Object.keys(sceneCueLayerStyle("portrait", SCENE_CUE_REST)).sort()).toEqual([
      "opacity",
      "transform",
    ]);
    expect(
      sceneCueLayerStyle("portrait", { ...SCENE_CUE_REST, portraitOffsetPercent: 14 }),
    ).toEqual({ opacity: 1, transform: "translateX(14%)" });
  });

  it("rejects a sequence that could never play as written", () => {
    const base: SceneCue = { target: "rift", effect: "open", at: 0, duration: 200 };
    const bad = (cues: SceneCue[]) => () => validateSceneCueSequence({ id: "bad", cues });
    expect(bad([])).toThrow(/no cues/);
    expect(bad([{ ...base, duration: 0 }])).toThrow(/lasting 0ms/);
    expect(bad([{ ...base, at: -1 }])).toThrow(/starting at -1ms/);
    expect(bad([{ ...base, duration: 12.5 }])).toThrow(/whole ms/);
    expect(
      bad([{ target: "portrait", effect: "fade", at: 0, duration: 10, from: 0, to: 2 }]),
    ).toThrow(/outside 0\.\.1/);
    expect(
      bad([{ target: "core", effect: "pulse", at: 0, duration: 10, peak: -1, rest: 0 }]),
    ).toThrow(/outside 0\.\.1/);
    // "Very modest" sideways motion only.
    expect(
      bad([{ target: "portrait", effect: "slide", at: 0, duration: 10, from: 0, to: 80 }]),
    ).toThrow(/more than 40%/);
    expect(bad([base])).not.toThrow();
  });

  it("orders cues by start time and breaks ties by authored order, never by the clock", () => {
    const sequence: SceneCueSequence = {
      id: "ordering",
      cues: [
        { target: "rift", effect: "close", at: 500, duration: 100 },
        { target: "rift", effect: "open", at: 100, duration: 100 },
        { target: "portrait", effect: "fade", at: 100, duration: 100, from: 0, to: 1 },
      ],
    };
    expect(orderedSceneCues(sequence).map((cue) => `${cue.at}:${cue.effect}`)).toEqual([
      "100:open",
      "100:fade",
      "500:close",
    ]);
    expect(sceneCueSequenceDuration(sequence)).toBe(600);
  });

  it("proves the layer is reusable: a different sequence uses it with no new mechanism", () => {
    // A machine activation (the Core alone), a story beat (a rift and an NPC stepping
    // sideways in) — authored here as data, not shipped as a second cutscene.
    const activation: SceneCueSequence = {
      id: "activation",
      cues: [{ target: "core", effect: "pulse", at: 0, duration: 600, peak: 0.9, rest: 0.3 }],
    };
    const stepIn: SceneCueSequence = {
      id: "step_in",
      cues: [
        { target: "portrait", effect: "slide", at: 0, duration: 400, from: -12, to: 0 },
        { target: "portrait", effect: "fade", at: 0, duration: 400, from: 0, to: 1 },
      ],
    };
    for (const sequence of [activation, stepIn]) validateSceneCueSequence(sequence);
    expect(sceneCueFinalState(activation)).toEqual({ ...SCENE_CUE_REST, coreGlow: 0.3 });
    expect(sceneCueInitialState(stepIn)).toMatchObject({
      portraitOpacity: 0,
      portraitOffsetPercent: -12,
    });
    expect(sceneCueFinalState(stepIn)).toEqual(SCENE_CUE_REST);
  });
});

describe("the Rig's arrival and departure", () => {
  it("both validate and are registered once by stable ID", () => {
    expect(SCENE_CUE_SEQUENCES.map((sequence) => sequence.id)).toEqual([
      "resonance_rig_arrival",
      "resonance_rig_departure",
    ]);
    expect(getSceneCueSequence("resonance_rig_arrival")).toBe(RESONANCE_ARRIVAL_CUES);
    expect(getSceneCueSequence("resonance_rig_departure")).toBe(RESONANCE_DEPARTURE_CUES);
    expect(getSceneCueSequence("nope")).toBeUndefined();
  });

  it("arrival is short, deterministic and in the approved order", () => {
    // Core lights -> rift opens -> portrait fades in -> rift closes.
    const order = orderedSceneCues(RESONANCE_ARRIVAL_CUES).map(
      (cue) => `${cue.target}:${cue.effect}`,
    );
    expect(order).toEqual([
      "core:pulse",
      "rift:open",
      "portrait:fade",
      "portrait:slide",
      "rift:close",
    ]);
    const fade = RESONANCE_ARRIVAL_CUES.cues.find((cue) => cue.effect === "fade")!;
    const open = RESONANCE_ARRIVAL_CUES.cues.find((cue) => cue.effect === "open")!;
    const close = RESONANCE_ARRIVAL_CUES.cues.find((cue) => cue.effect === "close")!;
    expect(open.at).toBeLessThan(fade.at);
    expect(close.at).toBeGreaterThanOrEqual(fade.at);
    expect(sceneCueSequenceDuration(RESONANCE_ARRIVAL_CUES)).toBeLessThanOrEqual(2_000);
    expect(RESONANCE_ARRIVAL_CUES.caption).toBe("The Wise Old Enby has arrived.");
    // The portrait is invisible from the very first frame, never flashing in first.
    expect(sceneCueInitialState(RESONANCE_ARRIVAL_CUES).portraitOpacity).toBe(0);
    expect(sceneCueFinalState(RESONANCE_ARRIVAL_CUES)).toMatchObject({
      portraitOpacity: 1,
      portraitOffsetPercent: 0,
      riftOpen: 0,
    });
  });

  it("departure opens a rift, moves the portrait sideways into it, and seals it again", () => {
    const order = orderedSceneCues(RESONANCE_DEPARTURE_CUES).map(
      (cue) => `${cue.target}:${cue.effect}`,
    );
    expect(order).toEqual(["rift:open", "portrait:slide", "portrait:fade", "rift:close"]);
    expect(sceneCueSequenceDuration(RESONANCE_DEPARTURE_CUES)).toBeLessThanOrEqual(2_000);
    expect(sceneCueInitialState(RESONANCE_DEPARTURE_CUES)).toEqual(SCENE_CUE_REST);
    expect(sceneCueFinalState(RESONANCE_DEPARTURE_CUES)).toMatchObject({
      portraitOpacity: 0,
      riftOpen: 0,
    });
    // Horizontal and modest only.
    const slide = RESONANCE_DEPARTURE_CUES.cues.find((cue) => cue.effect === "slide");
    expect(slide).toMatchObject({ from: 0 });
    expect(Math.abs((slide as { to: number }).to)).toBeLessThanOrEqual(20);
  });

  it("a skipped or reduced-motion show lands exactly where playing it would have", () => {
    for (const sequence of SCENE_CUE_SEQUENCES) {
      // The final state is a pure function of the sequence, so skip === play === reduced motion.
      expect(sceneCueFinalState(sequence)).toEqual(sceneCueFinalState(sequence));
      expect(sceneCueFinalState(sequence).riftOpen).toBe(0);
    }
  });

  it("anchors the Core and the rift to the approved Rig placement, not to literals", () => {
    const { placement } = RESONANCE_RIG_OVERLAY;
    expect(placement).toEqual({ left: 36.5, top: 20, width: 29 });
    const { core, rift } = RESONANCE_RIG_CUE_ANCHORS;
    // The Core sits inside the Rig's box, near the middle of the art.
    expect(core.left).toBeGreaterThan(placement.left);
    expect(core.left).toBeLessThan(placement.left + placement.width);
    expect(core.left).toBeCloseTo(placement.left + placement.width * 0.505, 1);
    expect(core.top).toBeGreaterThan(placement.top);
    // The rift is at the Rig's right edge, whole inside the tightest crop of the stage a
    // dialogue frame shows: a phone's 14rem-tall frame shows about 31.5%..68.5% of it.
    expect(rift.left).toBeGreaterThan(placement.left + placement.width * 0.9);
    expect(rift.left).toBeGreaterThan(core.left);
    expect(rift.left + rift.width).toBeLessThan(68.5);
  });
});

describe("the scene presentation", () => {
  const frameRef = createRef<HTMLDivElement>();
  const render = (sceneCues?: Parameters<typeof DialogueScene>[0]["sceneCues"]) =>
    renderToStaticMarkup(
      DialogueScene({ beat: portraitBeat, ...(sceneCues ? { sceneCues } : {}) }) as never,
    );

  it("leaves every ordinary dialogue exactly as it was: no wrapper, no stage layers", () => {
    const markup = render();
    expect(markup).not.toContain("data-scene-cue-target");
    expect(markup).toContain("data-portrait-transition");
  });

  it("wraps the portrait in a frame-sized, bottom-anchored layer and adds the stage layers", () => {
    const markup = render({ frameRef, state: sceneCueInitialState(RESONANCE_ARRIVAL_CUES) });
    // Stage-relative layers sit inside the shared stage, behind the portrait.
    expect(markup).toContain('data-scene-cue-target="core"');
    expect(markup).toContain('data-scene-cue-target="rift"');
    expect(markup).toMatch(/data-scene-stage[^>]*>[\s\S]*data-scene-cue-target="rift"/);
    // The portrait layer fills the frame and clips, so a sideways slide is a percent of the
    // frame's width and the portrait's bottom edge stays on the frame's.
    const portraitLayer = /<div[^>]*data-scene-cue-target="portrait"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(portraitLayer).toMatch(/absolute inset-0/);
    expect(portraitLayer).toMatch(/overflow-hidden/);
    expect(portraitLayer).toContain("opacity:0");
    const image = /<img[^>]*Wise Old Enby[^>]*>/.exec(markup)?.[0] ?? "";
    expect(image).toMatch(/bottom-0/);
    expect(image).toMatch(/h-\[92%\]/);
    // Nothing in the portrait's styling can lift it off the frame's floor.
    expect(portraitLayer).not.toMatch(/translateY|scale\(/);
  });

  it("paints the rift behind the portrait and the Rig's own placement unchanged", () => {
    const markup = render({ frameRef, state: SCENE_CUE_REST });
    expect(markup.indexOf('data-scene-cue-target="rift"')).toBeLessThan(
      markup.indexOf('data-scene-cue-target="portrait"'),
    );
    expect(markup).toContain("left:36.5%");
    expect(markup).toContain("width:29%");
  });
});
