"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { GAMEPLAY_ACCESS_REQUIRED_CODE } from "@/game/domain/gameplay-access";
import type { RealtimeEventMap, RealtimeEventType } from "@/game/schemas/realtime";
import {
  createRealtimeConnection,
  isolated,
  type ReconcileReason,
  type RealtimeStatus,
} from "./realtime-connection";
import {
  INITIAL_SOCIAL_SHELL_STATE,
  socialAttentionCount,
  socialShellReducer,
  type SocialCard,
} from "./social-state";

/**
 * The Chat/Social seam for one Play tab (issue #245). It owns the tab's single
 * realtime stream and the shell's presentation state, and is what downstream
 * social features consume:
 *
 * - `subscribe(type, handler)` — typed deliveries from the shared stream;
 * - `onReconcile(handler)` — re-read durable state after connect, reconnect,
 *   or tab resume (the only recovery path; the stream is never replayed). A
 *   feature still does its own initial read on mount: it may mount after the
 *   stream is already live;
 * - `upsertCard` / `removeCard` — the pinned actionable-card region;
 * - `setAttention(source, count)` — the launcher's attention state.
 *
 * Open/closed state lives here, not in any launcher, so the docked desktop
 * presentation (#286) renders the same surface without the floating button.
 * `open` is the logical open intent — the modal Drawer on a phone, an explicit
 * selection in the desktop dock — and Play may own it (`open` + `onOpenChange`)
 * so Chat and the other utilities share one single-open rule. `surfaceVisible`
 * is the separate fact that the Chat surface is actually mounted on screen,
 * docked or modal, which is what "the player has seen this" decisions need: a
 * passive desktop home shows Chat without any open intent.
 * Nothing here is gameplay authority, and it never drives Play's own bounded
 * refresh.
 */

type DeliveryHandler = (data: unknown) => void;
type ReconcileHandler = (reason: ReconcileReason) => void;

type SocialContextValue = {
  status: RealtimeStatus;
  open: boolean;
  /** The Chat surface is mounted on screen, docked or in the Drawer. */
  surfaceVisible: boolean;
  setSurfaceVisible: (visible: boolean) => void;
  openSocial: () => void;
  closeSocial: () => void;
  launcherRef: RefObject<HTMLButtonElement | null>;
  cards: readonly SocialCard[];
  attentionCount: number;
  upsertCard: (card: SocialCard) => void;
  removeCard: (key: string) => void;
  setAttention: (source: string, count: number) => void;
  subscribe: <Type extends RealtimeEventType>(
    type: Type,
    handler: (data: RealtimeEventMap[Type]) => void,
  ) => () => void;
  onReconcile: (handler: ReconcileHandler) => () => void;
};

const SocialContext = createContext<SocialContextValue | undefined>(undefined);

export function SocialProvider({
  characterId,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  characterId: string;
  children: ReactNode;
  /** When supplied, the open intent is owned by the caller (Play's utility workspace). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  // Read through a ref so a new router object never tears down the stream.
  const routerRef = useRef(router);
  routerRef.current = router;
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [ownOpen, setOwnOpen] = useState(false);
  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const open = controlledOpen ?? ownOpen;
  // Read through a ref so a new callback identity never rebuilds the context.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setOwnOpen(next);
      onOpenChangeRef.current?.(next);
    },
    [controlledOpen],
  );
  const [shell, dispatch] = useReducer(socialShellReducer, INITIAL_SOCIAL_SHELL_STATE);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const deliveryHandlers = useRef(new Map<string, Set<DeliveryHandler>>());
  const reconcileHandlers = useRef(new Set<ReconcileHandler>());

  useEffect(() => {
    const connection = createRealtimeConnection({
      characterId,
      callbacks: {
        onStatus: setStatus,
        // Each consumer is isolated so one failure cannot skip the others.
        onReconcile: (reason) => {
          for (const handler of [...reconcileHandlers.current]) isolated(() => handler(reason));
        },
        onDelivery: (envelope) => {
          const handlers = deliveryHandlers.current.get(envelope.type);
          for (const handler of handlers ? [...handlers] : [])
            isolated(() => handler(envelope.data));
        },
        onRefused: ({ code }) => {
          // Issue #223: access was revoked or closed since this page loaded;
          // recover to Characters exactly like the other gameplay reads.
          if (code === GAMEPLAY_ACCESS_REQUIRED_CODE) routerRef.current.replace("/characters");
        },
      },
    });
    connection.start();

    const resume = () => {
      if (document.visibilityState === "visible") connection.resume();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) connection.resume();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", onPageShow);
      connection.stop();
    };
  }, [characterId]);

  const subscribe = useCallback<SocialContextValue["subscribe"]>((type, handler) => {
    const handlers = deliveryHandlers.current.get(type) ?? new Set<DeliveryHandler>();
    deliveryHandlers.current.set(type, handlers);
    // The registry is keyed by type, so each handler only ever receives its
    // own type's payload.
    const untyped = handler as DeliveryHandler;
    handlers.add(untyped);
    return () => {
      handlers.delete(untyped);
    };
  }, []);

  const onReconcile = useCallback((handler: ReconcileHandler) => {
    reconcileHandlers.current.add(handler);
    return () => {
      reconcileHandlers.current.delete(handler);
    };
  }, []);

  const value = useMemo<SocialContextValue>(
    () => ({
      status,
      open,
      surfaceVisible,
      setSurfaceVisible,
      openSocial: () => setOpen(true),
      closeSocial: () => setOpen(false),
      launcherRef,
      cards: shell.cards,
      attentionCount: socialAttentionCount(shell),
      upsertCard: (card) => dispatch({ type: "upsertCard", card }),
      removeCard: (key) => dispatch({ type: "removeCard", key }),
      setAttention: (source, count) => dispatch({ type: "setAttention", source, count }),
      subscribe,
      onReconcile,
    }),
    [onReconcile, open, setOpen, shell, status, subscribe, surfaceVisible],
  );

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial() {
  const context = useContext(SocialContext);
  if (!context) throw new Error("Chat/Social is unavailable");
  return context;
}
