"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePlay } from "@/features/play/PlayContext";
import { refreshPlayAction, teleportWithRuneAction } from "@/server/actions";
import {
  TELEPORT_COMMAND_TIMEOUT_MS,
  TELEPORT_RECONCILE_TIMEOUT_MS,
  UNCONFIRMED_MESSAGE,
  outcomeOfAction,
  outcomeOfReread,
  teleportDurations,
  type TeleportOutcome,
  type TeleportPhase,
} from "./teleport-timeline";

export type TeleportNotice = { tone: "danger"; message: string };

type TeleportRequest = {
  stackId: string;
  expectedQuantity: number;
  /**
   * Where focus returns if the player is still in the departure world afterwards,
   * resolved once the world is whole again (the control that started it may by
   * then be disabled, or gone).
   */
  returnFocus?: () => HTMLElement | null;
};

type TeleportCinematicValue = {
  phase: TeleportPhase;
  /** True from the first frame of the breakup until the world is whole again. */
  active: boolean;
  notice: TeleportNotice | undefined;
  clearNotice: () => void;
  begin: (request: TeleportRequest) => void;
};

const TeleportCinematicContext = createContext<TeleportCinematicValue | undefined>(undefined);

export function useTeleportCinematic(): TeleportCinematicValue {
  const value = useContext(TeleportCinematicContext);
  if (!value) throw new Error("Teleport cinematic is unavailable");
  return value;
}

/** For passive readers (Inventory's feedback line) that must render without the provider. */
export function useOptionalTeleportCinematic(): TeleportCinematicValue | undefined {
  return useContext(TeleportCinematicContext);
}

/** The least time the screen stays fully black once the destination has been committed behind it. */
const FULL_BLACK_HOLD_MS = 120;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const sleep = (ms: number) =>
  ms <= 0 ? Promise.resolve() : new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Two painted frames, with a timeout so a hidden tab (no frames) can never stall the reveal. */
const settleFrames = () =>
  Promise.race([
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ),
    sleep(120),
  ]);

function withTimeout<Value>(promise: Promise<Value>, ms: number): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("failed"));
      },
    );
  });
}

/** Opacity of the black layer, driven by the Web Animations API so the fade survives reduced-motion CSS overrides. */
async function fadeBlack(layer: HTMLElement | null, to: 0 | 1, ms: number): Promise<void> {
  if (!layer) return;
  const from = to === 1 ? 0 : 1;
  layer.style.opacity = String(from);
  if (ms <= 0 || typeof layer.animate !== "function") {
    layer.style.opacity = String(to);
    await sleep(ms);
    return;
  }
  const animation = layer.animate([{ opacity: from }, { opacity: to }], {
    duration: ms,
    easing: to === 1 ? "ease-in" : "ease-out",
    fill: "forwards",
  });
  try {
    await animation.finished;
  } catch {
    // A cancelled animation still ends at the intended opacity below.
  }
  layer.style.opacity = String(to);
  animation.cancel();
}

/**
 * The Skatboll TP Rune's teleport cinematic (#438).
 *
 * It owns one timeline and one rule: the departure world stays exactly as the
 * player saw it until the screen is fully black, and no authoritative state is
 * accepted until then. The sequence is
 *
 *   gate acquired → A (visible UI breaks apart) → B (fully opaque black) →
 *   guarded server command → accept the confirmed state *behind the black* →
 *   C (black lifts, the world reassembles) → gate released → arrival modal.
 *
 * Every presentation step is cosmetic. Whether the teleport happened is the
 * server's answer alone, or, when the transport is uncertain, the server's
 * re-read of location, Inventory and durable receipt. Every exit path (refusal,
 * error, timeout, unmount) lifts the black and releases the gate, so no failure
 * leaves the player behind the scrim; a reload simply discards it.
 *
 * The phases are published as `data-rs-teleport` on the document element, which
 * is what the authored CSS (`app/globals.css`, "Teleport cinematic") keys on, so
 * portal-mounted Drawers, the header, footer and rail are all covered by one switch.
 */
export function TeleportCinematicProvider({
  children,
  onTeleported,
}: {
  children: ReactNode;
  /** Runs behind the black after a confirmed teleport: leave a stale map or place route. */
  onTeleported: () => void;
}) {
  const { acceptState, closeUtilityPanel, enqueueForeground, releaseCommand, state } = usePlay();
  const [phase, setPhase] = useState<TeleportPhase>("idle");
  const [notice, setNotice] = useState<TeleportNotice>();
  const [, startTransition] = useTransition();
  const blackRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const characterIdRef = useRef(state.characterId);
  characterIdRef.current = state.characterId;
  const onTeleportedRef = useRef(onTeleported);
  onTeleportedRef.current = onTeleported;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // One switch for every region, portaled Drawers included. Removed on unmount
  // so a Play boundary failure can never leave the document in a breakup pose.
  useEffect(() => {
    const root = document.documentElement;
    if (phase === "idle") root.removeAttribute("data-rs-teleport");
    else root.setAttribute("data-rs-teleport", phase);
    return () => root.removeAttribute("data-rs-teleport");
  }, [phase]);

  // While the cinematic runs the screen is not interactive: pointer events are
  // caught by the scrim, and the keyboard is swallowed here, Escape and Tab
  // included, so nothing behind it can be activated or have focus pulled away.
  const active = phase !== "idle";
  useEffect(() => {
    if (!active) return;
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", swallow, true);
    return () => window.removeEventListener("keydown", swallow, true);
  }, [active]);

  const inTransition = useCallback(
    <Value,>(work: () => Promise<Value>) =>
      new Promise<Value>((resolve, reject) => {
        startTransition(async () => {
          try {
            resolve(await work());
          } catch (error) {
            reject(error instanceof Error ? error : new Error("failed"));
          }
        });
      }),
    [],
  );

  /** The server's ruling for one intent, or its re-read when the command could not be ruled on. */
  const settle = useCallback(
    async (intentId: string, request: TeleportRequest): Promise<TeleportOutcome> => {
      const characterId = characterIdRef.current;
      const reconcile = async () => {
        try {
          const reread = await withTimeout(
            inTransition(() => refreshPlayAction(characterId)),
            TELEPORT_RECONCILE_TIMEOUT_MS,
          );
          return "state" in reread
            ? outcomeOfReread(reread.state, intentId)
            : outcomeOfReread(undefined, intentId);
        } catch {
          return outcomeOfReread(undefined, intentId);
        }
      };
      try {
        const result = await withTimeout(
          inTransition(() =>
            teleportWithRuneAction({
              characterId,
              intentId,
              stackId: request.stackId,
              expectedQuantity: request.expectedQuantity,
            }),
          ),
          TELEPORT_COMMAND_TIMEOUT_MS,
        );
        const outcome = outcomeOfAction(result);
        if (outcome) return outcome;
        // A plain refusal from the shared boundary (flight, trade, ownership): the
        // server's words, over a fresh read so the view matches what it knows.
        const reread = await reconcile();
        const message = "error" in result ? result.error : UNCONFIRMED_MESSAGE;
        return reread.kind === "teleported"
          ? reread
          : reread.kind === "unchanged"
            ? { kind: "refused", message, state: reread.state }
            : { kind: "unknown", message };
      } catch {
        return reconcile();
      }
    },
    [inTransition],
  );

  const run = useCallback(
    async (request: TeleportRequest) => {
      const intentId = crypto.randomUUID();
      const durations = teleportDurations(prefersReducedMotion());
      let outcome: TeleportOutcome = { kind: "unknown", message: UNCONFIRMED_MESSAGE };
      try {
        // A: the visible UI comes apart. Nothing authoritative is touched.
        setPhase("destabilize");
        await sleep(durations.destabilize);
        // B: fully opaque black. Only then is the command issued.
        setPhase("collapse");
        await fadeBlack(blackRef.current, 1, durations.collapse);
        outcome = await settle(intentId, request);
        // C: commit what the server confirmed, still behind the black.
        if ("state" in outcome) acceptState(outcome.state);
        if (outcome.kind === "teleported") {
          closeUtilityPanel();
          onTeleportedRef.current();
          setNotice(undefined);
        } else {
          setNotice({ tone: "danger", message: outcome.message });
        }
        // Hold the fully black screen long enough for the world behind it to paint,
        // and for the beat to read as a deliberate one rather than a flicker.
        await settleFrames();
        await sleep(FULL_BLACK_HOLD_MS);
        setPhase("reveal");
        await fadeBlack(blackRef.current, 0, durations.reveal);
      } finally {
        if (mountedRef.current) setPhase("idle");
        runningRef.current = false;
        releaseCommand();
        if (outcome.kind !== "teleported") {
          window.requestAnimationFrame(() => {
            const target = request.returnFocus?.();
            if (target?.isConnected) target.focus();
          });
        }
      }
    },
    [acceptState, closeUtilityPanel, releaseCommand, settle],
  );

  const begin = useCallback(
    (request: TeleportRequest) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setNotice(undefined);
      // The one foreground command gate: held for the whole cinematic, so no
      // other command or background refresh can touch Play state until it ends.
      enqueueForeground(() => {
        void run(request);
      });
    },
    [enqueueForeground, run],
  );

  const clearNotice = useCallback(() => setNotice(undefined), []);
  const value = useMemo<TeleportCinematicValue>(
    () => ({ phase, active, notice, clearNotice, begin }),
    [phase, active, notice, clearNotice, begin],
  );

  return (
    <TeleportCinematicContext.Provider value={value}>
      {children}
      {phase !== "idle" && typeof document !== "undefined"
        ? createPortal(<TeleportScrim blackRef={blackRef} />, document.body)
        : null}
    </TeleportCinematicContext.Provider>
  );
}

/**
 * The cinematic's top layer: above every Drawer and bar, catching all pointer
 * input. Seam lines (restrained cyan/violet) cross the screen during the breakup;
 * the black layer is the truly opaque scrim that conceals the world change.
 */
function TeleportScrim({ blackRef }: { blackRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div
      aria-busy="true"
      className="rs-tp-scrim"
      data-teleport-scrim=""
      role="status"
      tabIndex={-1}
    >
      <span className="sr-only">Teleporting. Please wait.</span>
      <div aria-hidden="true" className="rs-tp-seams">
        <i className="rs-tp-seam rs-tp-seam--h1" />
        <i className="rs-tp-seam rs-tp-seam--h2" />
        <i className="rs-tp-seam rs-tp-seam--v1" />
        <i className="rs-tp-seam rs-tp-seam--v2" />
      </div>
      <div aria-hidden="true" className="rs-tp-black" data-teleport-black="" ref={blackRef} />
    </div>
  );
}
