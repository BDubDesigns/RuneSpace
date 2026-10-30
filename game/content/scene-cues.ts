import { RESONANCE_RIG_OVERLAY } from "@/game/content/locations";
import {
  validateSceneCueSequence,
  type SceneCue,
  type SceneCueSequence,
} from "@/game/domain/scene-cues";

/**
 * The authored scene-cue sequences (#441) and where the world-relative layers sit.
 *
 * Both sequences below belong to the Wise Old Enby's visit to a character's personal
 * Resonance Rig and are presentation only: the Rig, the Mission, the runes and the
 * Enby's placement are settled by the server before either plays, and skipping one
 * changes none of them. The Enby's portraits are cropped at the feet, so every
 * portrait cue is an opacity change or a modest HORIZONTAL slide; nothing here, and
 * nothing the cue vocabulary allows, moves a portrait vertically or scales it.
 */

/**
 * Where the stage-relative layers sit, in percent of the shared 1536x384 stage.
 * Derived from the Rig overlay's own approved placement and from fractions of the
 * Rig artwork's canvas, so moving the Rig on QA evidence moves the Core glow and
 * the rift with it and they can never drift off the art.
 *
 * `core` is the Runestone's centre on the master canvas. `rift` is a thin vertical
 * tear at the Rig's right edge, clear of an Enby standing before it. It sits at 98.5%
 * of the Rig's width because a phone's dialogue frame is taller than 15:8 (a 14rem
 * floor) and so crops the 4:1 stage to about 31.5%..68.5%: the rift must still be
 * whole there.
 */
const RIG_STAGE_HEIGHT_PERCENT =
  (((RESONANCE_RIG_OVERLAY.placement.width / 100) * 1536 * RESONANCE_RIG_OVERLAY.height) /
    RESONANCE_RIG_OVERLAY.width /
    384) *
  100;

const onRig = (fractionX: number, fractionY: number) => ({
  left: RESONANCE_RIG_OVERLAY.placement.left + RESONANCE_RIG_OVERLAY.placement.width * fractionX,
  top: RESONANCE_RIG_OVERLAY.placement.top + RIG_STAGE_HEIGHT_PERCENT * fractionY,
});

const round = (value: number) => Math.round(value * 100) / 100;

export const RESONANCE_RIG_CUE_ANCHORS = {
  core: (() => {
    const centre = onRig(0.505, 0.415);
    // Centre point and diameter, as percent of the stage.
    return { left: round(centre.left), top: round(centre.top), size: 9.5 };
  })(),
  rift: (() => {
    const edge = onRig(0.985, 0.1);
    // Top-left corner, width and height, as percent of the stage.
    return {
      left: round(edge.left),
      top: round(edge.top),
      width: 2.4,
      height: round(RIG_STAGE_HEIGHT_PERCENT * 0.74),
    };
  })(),
} as const;

const arrival: SceneCue[] = [
  // The installed Core illuminates...
  { target: "core", effect: "pulse", at: 0, duration: 700, peak: 1, rest: 0.55 },
  // ...a thin crooked rift opens beside the Rig...
  { target: "rift", effect: "open", at: 450, duration: 450 },
  // ...the existing Enby portrait fades in, from a hair to the side, clipped at the feet...
  { target: "portrait", effect: "fade", at: 800, duration: 600, from: 0, to: 1 },
  { target: "portrait", effect: "slide", at: 800, duration: 600, from: 6, to: 0 },
  // ...and the rift closes behind them.
  { target: "rift", effect: "close", at: 1450, duration: 400 },
];

/** The Wise Old Enby arrives at a finished personal Rig (about two seconds). */
export const RESONANCE_ARRIVAL_CUES: SceneCueSequence = {
  id: "resonance_rig_arrival",
  cues: arrival,
  caption: "The Wise Old Enby has arrived.",
};

/** The Wise Old Enby leaves for Stillreach on their own rune (about two seconds). */
export const RESONANCE_DEPARTURE_CUES: SceneCueSequence = {
  id: "resonance_rig_departure",
  cues: [
    { target: "rift", effect: "open", at: 0, duration: 450 },
    // They step sideways toward the rift, fading as they go, never leaving the frame's floor.
    { target: "portrait", effect: "slide", at: 400, duration: 800, from: 0, to: 14 },
    { target: "portrait", effect: "fade", at: 500, duration: 700, from: 1, to: 0 },
    { target: "rift", effect: "close", at: 1250, duration: 400 },
  ],
};

export const SCENE_CUE_SEQUENCES = [RESONANCE_ARRIVAL_CUES, RESONANCE_DEPARTURE_CUES] as const;

for (const sequence of SCENE_CUE_SEQUENCES) validateSceneCueSequence(sequence);

export function getSceneCueSequence(id: string): SceneCueSequence | undefined {
  return SCENE_CUE_SEQUENCES.find((sequence) => sequence.id === id);
}
