"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ActionButton } from "@/components/ui/ActionButton";
import {
  getTheatreFilm,
  PRE_ROLL_DURATION_MS,
  THEATRE_COPY,
  THEATRE_PRE_ROLL_SLOTS,
  type TheatrePreRollSlot,
} from "@/game/content/theatre";
import { selectPreRollSlot } from "@/game/domain/theatre";
import { createMoviePlayer, loadFilm, type MoviePlayer } from "./studio-player";
import {
  filmControlsActive,
  initialViewerState,
  preRollPercent,
  shouldSuggestLandscape,
  viewerReducer,
} from "./viewer-machine";

/**
 * The server's answer to "may this viewing start?", as the viewer needs it. The viewer never
 * decides eligibility: every start (Watch Film, Replay Last Film, Restart, in-viewer Replay) asks.
 */
export type ViewingAuthorization =
  | { status: "allowed"; filmId: string }
  | { status: "refused"; message: string }
  | { status: "failed"; message: string };

const FULLSCREEN_SUGGESTION_KEY = "runespace:theatre:landscape-suggested";
const SUGGESTION_VISIBLE_MS = 6_000;
/** How often the honest pre-roll progress is re-read from the clock. */
const PRE_ROLL_TICK_MS = 100;
/** How often the film's position is re-read for the seek bar and clock. */
const TIME_POLL_MS = 100;

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function alreadySuggested(): boolean {
  try {
    return window.sessionStorage.getItem(FULLSCREEN_SUGGESTION_KEY) === "1";
  } catch {
    return suggestedThisPage;
  }
}
let suggestedThisPage = false;
function markSuggested() {
  suggestedThisPage = true;
  try {
    window.sessionStorage.setItem(FULLSCREEN_SUGGESTION_KEY, "1");
  } catch {
    // The suggestion is a courtesy; without storage it is shown once per page load instead.
  }
}

type FullscreenMode = "none" | "native" | "expanded";

/**
 * The Holo Drive-In's film viewer (#491): a mobile-first 16:9 overlay that plays one unskippable
 * pre-roll and then the ticket's film through the Holo Film Studio's public player.
 *
 * Lifecycle (see `viewer-machine`): every start asks the server first, draws a fresh pre-roll slot
 * independently at random, plays it with an honest, non-seekable progress bar, and only then starts
 * the film. The film has Play/Pause, a movie-only seek bar, Restart, an optional Scene
 * descriptions line (the films are silent and these are not closed captions), optional fullscreen
 * and Close; Close is on screen in every phase. The studio's own control bar, chapter picker and
 * caption toggle are never shown.
 *
 * Fullscreen is a CSS class on the same element tree, so playback position and state survive
 * entering and leaving it, and it never touches the ticket or the buff. Where native fullscreen is
 * unavailable the same overlay expands to the whole viewport instead.
 *
 * Mounted only while open and unmounted by closing it, by the panel above it leaving (the
 * character walked away) or by a refusal; none of those can touch a charge, a receipt or the
 * replay entitlement, which live on the server.
 */
export default function TheatreViewer({
  authorize,
  onClose,
  preRollMs = PRE_ROLL_DURATION_MS,
  standInAds,
  random = Math.random,
  returnFocusRef,
}: {
  authorize: () => Promise<ViewingAuthorization>;
  onClose: () => void;
  preRollMs?: number;
  /** True when the three slots are clearly labelled stand-in cards rather than finished commercials. */
  standInAds: boolean;
  random?: () => number;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [machine, dispatch] = useReducer(viewerReducer, preRollMs, initialViewerState);
  const { phase } = machine;
  const dialogRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const playerRef = useRef<MoviePlayer | undefined>(undefined);
  const syncTimeRef = useRef<() => void>(() => undefined);
  const [playerReady, setPlayerReady] = useState(false);
  const [fullscreen, setFullscreen] = useState<FullscreenMode>("none");
  const [sceneDescriptions, setSceneDescriptions] = useState(false);
  const [suggestion, setSuggestion] = useState(false);
  const [slot, setSlot] = useState<TheatrePreRollSlot | undefined>(undefined);
  const authorizeRef = useRef(authorize);
  authorizeRef.current = authorize;
  const randomRef = useRef(random);
  randomRef.current = random;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const startedFilmFor = useRef(0);

  // --- Every start asks the server, then draws its own pre-roll slot -------------------------
  useEffect(() => {
    let cancelled = false;
    authorizeRef
      .current()
      .then((result) => {
        if (cancelled) return;
        if (result.status === "allowed") {
          // Independent of every earlier draw: a repeat is allowed.
          const drawn = selectPreRollSlot(THEATRE_PRE_ROLL_SLOTS, randomRef.current);
          setSlot(drawn);
          dispatch({ type: "authorized", filmId: result.filmId, slotId: drawn.id });
        } else {
          dispatch({ type: result.status, message: result.message });
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({
            type: "failed",
            message: "Comms interruption. The projector could not confirm your ticket.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [machine.starts]);

  // --- The pre-roll's honest clock ------------------------------------------------------------
  const inPreRoll = phase.kind === "pre_roll";
  useEffect(() => {
    if (!inPreRoll) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      dispatch({ type: "pre_roll_tick", elapsedMs: performance.now() - startedAt });
    }, PRE_ROLL_TICK_MS);
    return () => window.clearInterval(timer);
  }, [inPreRoll, machine.starts]);

  // --- The film, loaded while the pre-roll plays so it can start the moment the pre-roll ends --
  const filmId = machine.filmId;
  useEffect(() => {
    const host = hostRef.current;
    if (!filmId || !host) return;
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    let player: MoviePlayer | undefined;
    loadFilm(filmId)
      .then((film) => {
        if (cancelled) return;
        // Picture only: the studio's control bar, chapter jumps and caption toggle stay hidden,
        // its keyboard shortcuts are off, and the film follows the OS reduced-motion setting.
        player = createMoviePlayer(host, {
          film,
          controls: false,
          keyboard: false,
          captions: false,
          reducedMotion: "auto",
        });
        playerRef.current = player;
        const updateTime = (ms: number) => {
          const duration = player?.duration ?? 0;
          if (duration <= 0) return;
          const slider = sliderRef.current;
          if (slider) {
            slider.value = String(Math.round((ms / duration) * 1000));
            slider.setAttribute("aria-valuetext", `${formatClock(ms)} of ${formatClock(duration)}`);
            slider.style.setProperty("--p", `${(ms / duration) * 100}%`);
          }
          if (clockRef.current) {
            clockRef.current.textContent = `${formatClock(ms)} / ${formatClock(duration)}`;
          }
        };
        unsubscribers.push(
          player.on("state", (state) => {
            if (state === "ended") dispatch({ type: "ended" });
            else if (state === "playing" || state === "paused") {
              dispatch({ type: "playback", playback: state });
            }
          }),
        );
        // The studio documents a `time` event on the player but only its inner timeline emits
        // one, so the position is read from `player.time` a few times a second instead (and
        // right after a seek). Reading a getter keeps the viewer on the player's supported API.
        const poll = window.setInterval(() => updateTime(player?.time ?? 0), TIME_POLL_MS);
        unsubscribers.push(() => window.clearInterval(poll));
        syncTimeRef.current = () => updateTime(player?.time ?? 0);
        updateTime(player.time);
        setPlayerReady(true);
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "failed", message: "The picture could not be loaded." });
      });
    return () => {
      cancelled = true;
      for (const off of unsubscribers) off();
      player?.destroy();
      playerRef.current = undefined;
      setPlayerReady(false);
    };
  }, [filmId]);

  // The film starts from its first frame once per start, the moment the pre-roll hands over.
  const filmPhase = phase.kind === "film";
  useEffect(() => {
    const player = playerRef.current;
    if (!filmPhase || !playerReady || !player) return;
    if (startedFilmFor.current === machine.starts) return;
    startedFilmFor.current = machine.starts;
    player.restart();
  }, [filmPhase, playerReady, machine.starts]);

  // A new start silences whatever the last viewing left running behind the pre-roll.
  useEffect(() => {
    if (phase.kind === "authorizing") playerRef.current?.pause();
  }, [phase.kind, machine.starts]);

  useEffect(() => {
    playerRef.current?.setCaptions(sceneDescriptions);
  }, [sceneDescriptions, playerReady]);

  // --- Fullscreen: native where supported, the same overlay expanded where not -------------
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === dialogRef.current;
      setFullscreen((current) => (active ? "native" : current === "native" ? "none" : current));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const enterFullscreen = useCallback(async () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.requestFullscreen === "function") {
      try {
        await dialog.requestFullscreen();
        setFullscreen("native");
        return;
      } catch {
        // Refused (for example by the browser or an embedding frame): expand instead.
      }
    }
    setFullscreen("expanded");
  }, []);

  const exitFullscreen = useCallback(async () => {
    if (document.fullscreenElement === dialogRef.current) {
      try {
        await document.exitFullscreen();
      } catch {
        // The change event, or the next toggle, settles it.
      }
    }
    setFullscreen("none");
  }, []);

  // The brief, dismissible suggestion to turn a portrait phone sideways, once per session.
  useEffect(() => {
    if (fullscreen === "none") {
      setSuggestion(false);
      return;
    }
    if (
      !shouldSuggestLandscape({
        portrait: window.matchMedia("(orientation: portrait)").matches,
        coarsePointer: window.matchMedia("(pointer: coarse)").matches,
        alreadySuggested: alreadySuggested(),
      })
    ) {
      return;
    }
    markSuggested();
    setSuggestion(true);
    const timer = window.setTimeout(() => setSuggestion(false), SUGGESTION_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [fullscreen]);

  // --- Dialog behaviour: scroll lock, focus in, focus back, Escape, Tab trap -----------------
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const returnTo = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (document.fullscreenElement === dialogRef.current) void document.exitFullscreen();
      returnTo?.focus?.();
    };
  }, [returnFocusRef]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      // The browser already leaves native fullscreen on Escape; the expanded fallback does the same.
      if (fullscreen === "expanded") setFullscreen("none");
      else onCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter(
      (element) =>
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // --- Controls -------------------------------------------------------------------------------
  const start = () => dispatch({ type: "start" });
  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.state === "ended") start();
    else player.toggle();
  };
  const filmTitle = filmId ? getTheatreFilm(filmId)?.title : undefined;
  const filmControls = filmControlsActive(phase);
  const playing = phase.kind === "film" && phase.playback === "playing";
  const showPicture = filmControls && playerReady;
  const percent = preRollPercent(machine);
  const remainingPreRoll =
    phase.kind === "pre_roll" ? Math.max(0, machine.preRollMs - phase.elapsedMs) : 0;
  const expanded = fullscreen !== "none";

  const dialog = (
    <div
      aria-label={filmTitle ? `${filmTitle} at the Holo Drive-In` : "Holo Drive-In film viewer"}
      aria-modal="true"
      className={`fixed inset-0 z-[90] flex items-center justify-center overscroll-contain bg-black ${
        expanded ? "p-0" : "p-2 sm:p-4"
      }`}
      data-fullscreen={fullscreen}
      data-phase={phase.kind}
      data-theatre-viewer
      onKeyDown={onKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <div
        className={`flex w-full flex-col gap-2 ${
          expanded ? "h-full justify-center" : "max-w-[min(100%,calc((100dvh_-_9.5rem)*16/9))]"
        }`}
      >
        {/* The picture. The film's own host stays mounted, hidden, through the pre-roll so it is
            ready the instant the pre-roll ends and a fullscreen change never rebuilds it. */}
        <div
          className={`relative aspect-video shrink-0 overflow-hidden bg-black ${
            expanded ? "mx-auto w-[min(100%,calc((100dvh_-_7.5rem)*16/9))]" : "w-full"
          }`}
          data-theatre-screen
        >
          <div
            aria-hidden={showPicture ? undefined : true}
            className={
              showPicture ? "h-full w-full [&_.mm-player]:rounded-none" : "invisible h-full w-full"
            }
            data-theatre-film-host
            ref={hostRef}
          />
          {phase.kind === "pre_roll" && slot ? (
            <PreRollStage slot={slot} standIn={standInAds} />
          ) : null}
          {phase.kind === "authorizing" ? (
            <ScreenMessage tone="info">Checking your ticket...</ScreenMessage>
          ) : null}
          {phase.kind === "film" && !playerReady ? (
            <ScreenMessage tone="info">Loading the picture...</ScreenMessage>
          ) : null}
          {phase.kind === "refused" || phase.kind === "failed" ? (
            <ScreenMessage tone="danger">
              <span role="alert">{phase.message}</span>
              {phase.kind === "failed" ? (
                <ActionButton intent="secondary" onClick={start}>
                  Try again
                </ActionButton>
              ) : null}
            </ScreenMessage>
          ) : null}
          {phase.kind === "ended" ? (
            <div
              className="absolute inset-0 flex items-center justify-center gap-3 bg-black/55"
              data-theatre-ended
            >
              <ActionButton intent="primary" onClick={start}>
                Replay
              </ActionButton>
              <ActionButton intent="secondary" onClick={() => onCloseRef.current()}>
                {THEATRE_COPY.close}
              </ActionButton>
            </div>
          ) : null}
          {suggestion ? (
            <div
              className="absolute inset-x-2 top-2 flex items-start justify-between gap-2 rounded border border-[color:var(--rs-accent-primary)] bg-black/85 px-3 py-2 text-sm text-[color:var(--rs-text-primary)]"
              data-landscape-suggestion
              role="status"
            >
              <span>
                For the best view, turn your phone sideways. You can keep watching either way.
              </span>
              <button
                aria-label="Dismiss"
                className="rs-focus min-h-9 min-w-9 text-[color:var(--rs-accent-primary)]"
                onClick={() => setSuggestion(false)}
                type="button"
              >
                OK
              </button>
            </div>
          ) : null}
        </div>

        {/* Controls. During the pre-roll only an honest progress bar, Fullscreen and Close. */}
        <div
          className={`flex flex-col gap-2 px-1 text-[color:var(--rs-text-primary)] ${
            expanded ? "pb-[env(safe-area-inset-bottom)]" : ""
          }`}
          data-theatre-controls
        >
          {phase.kind === "pre_roll" ? (
            <div className="flex flex-col gap-1" data-pre-roll-progress>
              <div className="flex items-baseline justify-between text-xs text-[color:var(--rs-text-secondary)]">
                <span>Commercial break</span>
                <span>{Math.ceil(remainingPreRoll / 1000)}s</span>
              </div>
              <div
                aria-label="Commercial break progress"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={percent}
                className="h-2 w-full overflow-hidden rounded bg-[color:var(--rs-border-subtle)]"
                role="progressbar"
              >
                <div
                  className="h-full bg-[color:var(--rs-accent-primary)]"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          ) : filmControls ? (
            <div className="flex items-center gap-3">
              <input
                aria-label="Seek"
                className="min-h-9 flex-1 accent-[color:var(--rs-accent-primary)]"
                defaultValue={0}
                max={1000}
                min={0}
                onInput={(event) => {
                  const player = playerRef.current;
                  if (!player || player.duration <= 0) return;
                  player.seek((Number(event.currentTarget.value) / 1000) * player.duration);
                  syncTimeRef.current();
                }}
                ref={sliderRef}
                step={1}
                type="range"
              />
              <span
                aria-hidden="true"
                className="shrink-0 text-xs tabular-nums text-[color:var(--rs-text-secondary)]"
                data-theatre-clock
                ref={clockRef}
              >
                0:00 / 0:00
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {filmControls ? (
              <>
                <ActionButton
                  aria-label={phase.kind === "ended" ? "Replay" : playing ? "Pause" : "Play"}
                  intent="primary"
                  onClick={togglePlayback}
                >
                  {phase.kind === "ended" ? "Replay" : playing ? "Pause" : "Play"}
                </ActionButton>
                <ActionButton intent="secondary" onClick={start}>
                  Restart
                </ActionButton>
                <ActionButton
                  aria-pressed={sceneDescriptions}
                  intent={sceneDescriptions ? "primary" : "secondary"}
                  onClick={() => setSceneDescriptions((on) => !on)}
                >
                  Scene descriptions
                </ActionButton>
              </>
            ) : null}
            <ActionButton
              aria-pressed={expanded}
              className="ml-auto"
              intent="secondary"
              onClick={() => (expanded ? void exitFullscreen() : void enterFullscreen())}
            >
              {expanded ? "Exit fullscreen" : "Fullscreen"}
            </ActionButton>
            <ActionButton intent="secondary" onClick={() => onCloseRef.current()} ref={closeRef}>
              {THEATRE_COPY.close}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );

  // A portal keeps the overlay viewport-fixed whatever styled ancestor it was opened from.
  return createPortal(dialog, document.body);
}

function ScreenMessage({ children, tone }: { children: ReactNode; tone: "info" | "danger" }) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-4 text-center text-sm ${
        tone === "danger"
          ? "text-[color:var(--rs-accent-danger)]"
          : "text-[color:var(--rs-text-secondary)]"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * The pre-roll's picture. Every slot is a plainly labelled stand-in card that says it is not a
 * commercial, so a playtest can exercise the whole lifecycle without anyone mistaking it for
 * approved creative. The viewer is not offered to players at all while a slot lacks its finished
 * commercial (`theatreViewerReady`), so this card only ever shows on an owner's preview or a test
 * build. The dedicated commercials slice replaces it with the studio film for each slot that gains
 * a `filmId`; `tests/unit/theatre-viewer.test.ts` fails until it does.
 */
function PreRollStage({ slot, standIn }: { slot: TheatrePreRollSlot; standIn: boolean }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[color:var(--rs-surface-page)] p-4 text-center"
      data-pre-roll-slot={slot.id}
      data-pre-roll-stand-in={standIn ? "true" : undefined}
    >
      <p className="font-display text-2xl font-bold text-[color:var(--rs-text-primary)]">
        {slot.title}
      </p>
      <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
        Stand-in card, not a finished commercial
      </p>
    </div>
  );
}
