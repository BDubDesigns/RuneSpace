/**
 * Scene cues (#441): a small, deterministic way to animate the layers of a composed
 * scene, and nothing more.
 *
 * A cue sequence is an authored, ordered list of cues. Each targets one of three
 * layers of the shared 15:8 composition and applies one narrow effect to it:
 *
 * - `core`     — a glow on a stage-relative point of the world art (the Rig's Core).
 * - `rift`     — a thin crooked tear in the stage, behind the portrait.
 * - `portrait` — the speaker's frame-relative portrait.
 *
 * It is deliberately NOT a cinematic engine, a timeline editor or a scripting
 * language: there is no vertical motion at all (an NPC portrait is cropped at the
 * feet and must never be slid, dropped or scaled so the crop shows), no easing
 * vocabulary beyond one eased curve, no branching and no callbacks. Timing is
 * absolute milliseconds from the sequence start, so the same sequence is the same
 * show at every viewport and a test can state its whole timeline.
 *
 * It is presentation only. A cue grants, moves and decides nothing: the server's
 * placement of an NPC, the Mission and the Rig are already settled before any
 * sequence runs, and skipping, interrupting or never mounting one changes none of
 * them. The same sequences can later serve dialogue events, story beats, machine
 * activations and other NPC exits without a new mechanism.
 */

export type SceneCueTarget = "core" | "rift" | "portrait";

export type SceneCue =
  /** Opacity of the portrait, 0..1. */
  | { target: "portrait"; effect: "fade"; at: number; duration: number; from: number; to: number }
  /**
   * A modest HORIZONTAL slide of the portrait, in percent of the frame width.
   * Only ever sideways: the portrait's bottom edge stays on the frame's.
   */
  | { target: "portrait"; effect: "slide"; at: number; duration: number; from: number; to: number }
  /** The rift tears open or seals shut, behind the portrait. */
  | { target: "rift"; effect: "open" | "close"; at: number; duration: number }
  /** The Core's glow rises to `peak` and settles at `rest`, 0..1. */
  | { target: "core"; effect: "pulse"; at: number; duration: number; peak: number; rest: number };

export type SceneCueSequence = {
  id: string;
  /** Cues in authored order; start times decide the show, order breaks ties. */
  cues: readonly SceneCue[];
  /**
   * A one-time caption presented when the sequence ends, for sequences that
   * announce something. Absent for a sequence that only plays under dialogue.
   */
  caption?: string;
};

/** What each layer looks like at one instant: the whole state a cue can change. */
export type SceneCueState = {
  portraitOpacity: number;
  /** Percent of the frame width, positive to the right. */
  portraitOffsetPercent: number;
  /** 0 is sealed and invisible, 1 is fully open. */
  riftOpen: number;
  coreGlow: number;
};

/** Every layer at rest: the portrait present and centred, the rift sealed, the Core dim. */
export const SCENE_CUE_REST: SceneCueState = {
  portraitOpacity: 1,
  portraitOffsetPercent: 0,
  riftOpen: 0,
  coreGlow: 0,
};

export const sceneCueEnd = (cue: SceneCue): number => cue.at + cue.duration;

/** Whole-sequence length in ms: when its last cue ends. */
export function sceneCueSequenceDuration(sequence: SceneCueSequence): number {
  return sequence.cues.reduce((end, cue) => Math.max(end, sceneCueEnd(cue)), 0);
}

/** Cues in the order they begin, ties broken by authored order, never by the clock. */
export function orderedSceneCues(sequence: SceneCueSequence): readonly SceneCue[] {
  return sequence.cues
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => a.cue.at - b.cue.at || a.index - b.index)
    .map(({ cue }) => cue);
}

function applyCueEnd(state: SceneCueState, cue: SceneCue): SceneCueState {
  switch (cue.effect) {
    case "fade":
      return { ...state, portraitOpacity: cue.to };
    case "slide":
      return { ...state, portraitOffsetPercent: cue.to };
    case "open":
      return { ...state, riftOpen: 1 };
    case "close":
      return { ...state, riftOpen: 0 };
    case "pulse":
      return { ...state, coreGlow: cue.rest };
  }
}

/**
 * The state the layers hold BEFORE the first cue runs: each layer's first cue
 * names where it starts, so a portrait that fades in is invisible from the first
 * frame rather than flashing visible and then vanishing.
 */
export function sceneCueInitialState(sequence: SceneCueSequence): SceneCueState {
  let state = SCENE_CUE_REST;
  const seen = new Set<string>();
  for (const cue of orderedSceneCues(sequence)) {
    const layer =
      cue.effect === "fade"
        ? "opacity"
        : cue.effect === "slide"
          ? "offset"
          : cue.target === "rift"
            ? "rift"
            : "core";
    if (seen.has(layer)) continue;
    seen.add(layer);
    if (cue.effect === "fade") state = { ...state, portraitOpacity: cue.from };
    else if (cue.effect === "slide") state = { ...state, portraitOffsetPercent: cue.from };
    else if (cue.effect === "close") state = { ...state, riftOpen: 1 };
  }
  return state;
}

/**
 * The state every layer ends in. A reduced-motion player and a skipped sequence
 * both go straight here, so the scene is always left exactly as playing it would
 * have left it.
 */
export function sceneCueFinalState(sequence: SceneCueSequence): SceneCueState {
  return orderedSceneCues(sequence).reduce(applyCueEnd, sceneCueInitialState(sequence));
}

/** One animation property keyframe set, as the Web Animations API takes it. */
export type SceneCueKeyframes = {
  keyframes: Record<string, string | number | null>[];
  easing: string;
};

/**
 * The keyframes for one cue. Pure, so a test can prove a cue's whole visual
 * contract — in particular that a portrait only ever moves along X.
 */
export function sceneCueKeyframes(cue: SceneCue): SceneCueKeyframes {
  const easing = "cubic-bezier(0.4, 0, 0.2, 1)";
  switch (cue.effect) {
    case "fade":
      return { keyframes: [{ opacity: cue.from }, { opacity: cue.to }], easing };
    case "slide":
      return {
        keyframes: [
          { transform: `translateX(${cue.from}%)` },
          { transform: `translateX(${cue.to}%)` },
        ],
        easing,
      };
    case "open":
      return {
        keyframes: [
          { opacity: 0, transform: "scale(0.35, 0.04)" },
          { opacity: 1, transform: "scale(1, 1)" },
        ],
        easing,
      };
    case "close":
      return {
        keyframes: [
          { opacity: 1, transform: "scale(1, 1)" },
          { opacity: 0, transform: "scale(0.35, 0.04)" },
        ],
        easing,
      };
    case "pulse":
      return {
        keyframes: [{ opacity: 0 }, { opacity: cue.peak, offset: 0.45 }, { opacity: cue.rest }],
        easing: "ease-out",
      };
  }
}

/** The CSS style a layer holds at one state, for the first frame and for the last. */
export function sceneCueLayerStyle(
  target: SceneCueTarget,
  state: SceneCueState,
): Record<string, string | number> {
  switch (target) {
    case "portrait":
      return {
        opacity: state.portraitOpacity,
        transform: `translateX(${state.portraitOffsetPercent}%)`,
      };
    case "rift":
      return state.riftOpen > 0
        ? { opacity: 1, transform: "scale(1, 1)" }
        : { opacity: 0, transform: "scale(0.35, 0.04)" };
    case "core":
      return { opacity: state.coreGlow };
  }
}

/**
 * Startup validation for an authored sequence: a sequence that could never play as
 * written would reach a player as a silent no-op.
 */
export function validateSceneCueSequence(sequence: SceneCueSequence): void {
  const where = `Scene cue sequence "${sequence.id}"`;
  if (sequence.cues.length === 0) throw new Error(`${where} authors no cues.`);
  const unit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  for (const cue of sequence.cues) {
    if (!Number.isInteger(cue.at) || cue.at < 0) {
      throw new Error(`${where} has a cue starting at ${cue.at}ms; it must be a whole ms >= 0.`);
    }
    if (!Number.isInteger(cue.duration) || cue.duration <= 0) {
      throw new Error(`${where} has a cue lasting ${cue.duration}ms; it must be a whole ms > 0.`);
    }
    if (cue.effect === "fade" && !(unit(cue.from) && unit(cue.to))) {
      throw new Error(`${where} fades a portrait outside 0..1.`);
    }
    if (cue.effect === "pulse" && !(unit(cue.peak) && unit(cue.rest))) {
      throw new Error(`${where} pulses the Core outside 0..1.`);
    }
    if (cue.effect === "slide" && Math.max(Math.abs(cue.from), Math.abs(cue.to)) > 40) {
      // "Very modest" sideways motion: a portrait never leaves its frame by sliding far.
      throw new Error(`${where} slides a portrait by more than 40% of the frame.`);
    }
  }
}
