/**
 * The theatre viewer's lifecycle as a pure state machine (#491). No DOM, clock, player or
 * server: the component feeds it events and renders what it says, and the unit tests drive it
 * directly. What it guarantees is the owner-locked shape of a viewing:
 *
 * - every start (Watch Film, Replay Last Film, Restart, in-viewer Replay) goes through the
 *   server first (`authorizing`), then plays exactly one pre-roll, then the film;
 * - the pre-roll cannot be skipped or sought through: the only way out of `pre_roll` is the
 *   elapsed time reaching the pre-roll's length, and no playback or ended event is honoured
 *   while it runs;
 * - a double tap on a start control while one is already authorizing starts nothing twice.
 *
 * Closing the whole viewer is not a state: the component simply unmounts, from any phase.
 */

export type ViewerPhase =
  /** The server is being asked whether this start is allowed. */
  | { kind: "authorizing" }
  /** The unskippable commercial, `elapsedMs` of `preRollMs` in. */
  | { kind: "pre_roll"; slotId: string; elapsedMs: number }
  /** The film itself, playing or paused. */
  | { kind: "film"; playback: "playing" | "paused" }
  /** The film reached its end: Replay or Close. */
  | { kind: "ended" }
  /** The server refused the start; nothing plays. */
  | { kind: "refused"; message: string }
  /** The request or the film could not be loaded; a start can be tried again. */
  | { kind: "failed"; message: string };

export type ViewerState = {
  phase: ViewerPhase;
  /** The film the server named for this viewing: the ticket's, not the showing's. */
  filmId: string | undefined;
  /** How long the pre-roll runs. */
  preRollMs: number;
  /** How many starts there have been, so a view can tell a restart from a continuation. */
  starts: number;
};

export type ViewerEvent =
  | { type: "start" }
  | { type: "authorized"; filmId: string; slotId: string }
  | { type: "refused"; message: string }
  | { type: "failed"; message: string }
  | { type: "pre_roll_tick"; elapsedMs: number }
  | { type: "playback"; playback: "playing" | "paused" }
  | { type: "ended" };

export function initialViewerState(preRollMs: number): ViewerState {
  if (!Number.isFinite(preRollMs) || preRollMs <= 0) {
    throw new RangeError("A pre-roll needs a positive length.");
  }
  return { phase: { kind: "authorizing" }, filmId: undefined, preRollMs, starts: 1 };
}

export function viewerReducer(state: ViewerState, event: ViewerEvent): ViewerState {
  const { phase } = state;
  switch (event.type) {
    case "start":
      // A second tap while the server is still answering the first starts nothing new.
      if (phase.kind === "authorizing") return state;
      return { ...state, phase: { kind: "authorizing" }, starts: state.starts + 1 };
    case "authorized":
      if (phase.kind !== "authorizing") return state;
      return {
        ...state,
        filmId: event.filmId,
        phase: { kind: "pre_roll", slotId: event.slotId, elapsedMs: 0 },
      };
    case "refused":
      return { ...state, phase: { kind: "refused", message: event.message } };
    case "failed":
      return { ...state, phase: { kind: "failed", message: event.message } };
    case "pre_roll_tick": {
      if (phase.kind !== "pre_roll") return state;
      // Time only moves forward, and never past the end: nothing but the clock reaching the
      // pre-roll's length hands over to the film.
      const elapsedMs = Math.min(state.preRollMs, Math.max(phase.elapsedMs, event.elapsedMs));
      if (elapsedMs >= state.preRollMs) {
        return { ...state, phase: { kind: "film", playback: "playing" } };
      }
      return { ...state, phase: { ...phase, elapsedMs } };
    }
    case "playback":
      // Seeking back from the end card puts the film back in play: it is the same viewing, so
      // it neither asks the server again nor draws another pre-roll.
      if (phase.kind !== "film" && phase.kind !== "ended") return state;
      return { ...state, phase: { kind: "film", playback: event.playback } };
    case "ended":
      if (phase.kind !== "film") return state;
      return { ...state, phase: { kind: "ended" } };
  }
}

/** Whether the film's own controls (play/pause, seek, scene descriptions) are in play. */
export function filmControlsActive(phase: ViewerPhase): boolean {
  return phase.kind === "film" || phase.kind === "ended";
}

/** The pre-roll's honest progress as a whole percentage, 0 when none is running. */
export function preRollPercent(state: ViewerState): number {
  if (state.phase.kind !== "pre_roll") return 0;
  return Math.min(100, Math.floor((state.phase.elapsedMs / state.preRollMs) * 100));
}

/**
 * Whether entering fullscreen should offer the "turn your phone sideways" suggestion: only on a
 * portrait touch device, and only once per browsing session. It is a suggestion, never a
 * requirement: nothing is blocked, locked or forced.
 */
export function shouldSuggestLandscape(input: {
  portrait: boolean;
  coarsePointer: boolean;
  alreadySuggested: boolean;
}): boolean {
  return input.portrait && input.coarsePointer && !input.alreadySuggested;
}
