"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { GAMEPLAY_ACCESS_REQUIRED_CODE } from "@/game/domain/gameplay-access";
import type {
  EndedTradeView,
  TradeRequestChange,
  TradeStateView,
} from "@/game/schemas/player-trade";
import { useChat } from "@/features/chat/ChatContext";
import { usePlay } from "@/features/play/PlayContext";
import { useSocial } from "@/features/social/SocialContext";
import {
  acceptTradeRequestAction,
  addTradeOfferItemAction,
  addTradeOfferStackAction,
  cancelTradeRequestAction,
  cancelTradeSessionAction,
  changeTradeOfferAction,
  confirmTradeAction,
  createTradeRequestAction,
  declineTradeRequestAction,
  readyTradeOfferAction,
  removeTradeOfferItemAction,
  removeTradeOfferStackAction,
  setTradeOfferCreditsAction,
  type PlayerTradeActionResult,
} from "@/server/actions";
import { IncomingTradeRequestCard, OutgoingTradeRequestCard } from "./TradeRequestCards";
import { endedRequestNote } from "./trade-presentation";

/**
 * Player trading for one Play tab (issue #268). It mirrors the active
 * character's durable trade state from `GET /api/trade` — never the realtime
 * stream, which only prompts a re-read — and is what every trade surface reads:
 * the profile's Trade action, the pinned Chat/Social request cards, and the
 * accepted-trade surface.
 *
 * - It re-reads on mount, on every reconnect or tab resume, on each
 *   `trade.request` / `trade.session` prompt, on a Block from another tab, and
 *   when a pending request or an idle session would lapse (expiry is derived
 *   on the server and published by no one). Every read and command answer is
 *   applied newest-issued-first, so a duplicate or late answer is harmless.
 * - Incoming requests become pinned actionable cards (keyed by request id) and
 *   light the Chat/Social launcher; the requester's own pending request is a
 *   quiet card with Cancel Request. Neither navigates or blocks gameplay.
 * - When a session this tab was showing disappears, the durable `ended` view
 *   says how it ended, and a completed trade asks Play to re-read its
 *   Inventory and Credits. Nothing moves in the UI before the server commits.
 */

/** Command answer for a trade control: a player-facing error, or nothing on success. */
export type TradeCommandError = string | undefined;

/** How the trade this tab was showing ended, until the player dismisses it. */
export type EndedTradeNotice = Pick<EndedTradeView, "exchange"> & {
  counterpartName: string;
  /** `ended`: over, in a way the latest read can no longer name. */
  outcome: EndedTradeView["outcome"] | "ended";
};

type SessionCommands = {
  setCredits: (credits: number) => Promise<TradeCommandError>;
  addStack: (itemId: string, quantity: number) => Promise<TradeCommandError>;
  removeStack: (itemId: string, quantity: number) => Promise<TradeCommandError>;
  addItem: (itemInstanceId: string) => Promise<TradeCommandError>;
  removeItem: (itemInstanceId: string) => Promise<TradeCommandError>;
  ready: () => Promise<TradeCommandError>;
  changeOffer: () => Promise<TradeCommandError>;
  confirm: () => Promise<TradeCommandError>;
  cancel: () => Promise<TradeCommandError>;
};

type PlayerTradeContextValue = {
  state: TradeStateView | undefined;
  ended: EndedTradeNotice | undefined;
  dismissEnded: () => void;
  /** Why the outgoing request stopped waiting, keyed to the character it went to. */
  requestNote: { name: string; text: string } | undefined;
  requestTrade: (characterName: string) => Promise<TradeCommandError>;
  cancelRequest: () => Promise<TradeCommandError>;
  acceptRequest: (requestId: string) => Promise<TradeCommandError>;
  declineRequest: (requestId: string) => Promise<TradeCommandError>;
  session: SessionCommands;
};

const PlayerTradeContext = createContext<PlayerTradeContextValue | undefined>(undefined);

const INCOMING_CARD_PREFIX = "trade-request:";
const OUTGOING_CARD_PREFIX = "trade-outgoing:";
const CONNECTION_ERROR = "That didn't reach RuneSpace. Check your connection and try again.";
/** A lapse is derived on the next read; re-read just after it is due. */
const LAPSE_GRACE_MS = 300;
const MIN_LAPSE_DELAY_MS = 1_000;

type ReadResult = { state: TradeStateView } | { error: string; code?: string };

async function readTradeState(characterId: string): Promise<ReadResult> {
  try {
    const response = await fetch(`/api/trade?${new URLSearchParams({ characterId })}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = (await response.json().catch(() => null)) as
      | TradeStateView
      | { error?: string; code?: string }
      | null;
    if (!response.ok || !body || "error" in body) {
      const refusal = body as { error?: string; code?: string } | null;
      return { error: refusal?.error ?? "Trades could not be loaded.", code: refusal?.code };
    }
    return { state: body as TradeStateView };
  } catch {
    return { error: "Trades could not be loaded." };
  }
}

export function PlayerTradeProvider({
  characterId,
  children,
}: {
  characterId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const { closeSocial, onReconcile, removeCard, subscribe, upsertCard } = useSocial();
  const { refreshNotices } = useChat();
  const { requestAutoRefresh, setCharacterOpen, setInventoryOpen, setMissionsOpen } = usePlay();
  const [state, setState] = useState<TradeStateView>();
  const [ended, setEnded] = useState<EndedTradeNotice>();
  const [requestNote, setRequestNote] = useState<{ name: string; text: string }>();
  const stateRef = useRef<TradeStateView | undefined>(undefined);
  // Newest-issued answer wins: a read or command issued earlier never
  // overwrites one issued later, whichever arrives last.
  const issued = useRef(0);
  const applied = useRef(0);
  // The session this tab last showed, so its disappearance can be explained.
  const shownSession = useRef<{ id: string; counterpartName: string } | undefined>(undefined);
  // Realtime change hints per request id, for the requester's note wording only.
  const requestChanges = useRef(new Map<string, TradeRequestChange>());
  const effects = useRef({
    closeSocial,
    requestAutoRefresh,
    setCharacterOpen,
    setInventoryOpen,
    setMissionsOpen,
  });
  effects.current = {
    closeSocial,
    requestAutoRefresh,
    setCharacterOpen,
    setInventoryOpen,
    setMissionsOpen,
  };

  const apply = useCallback((sequence: number, next: TradeStateView) => {
    if (sequence < applied.current) return;
    applied.current = sequence;
    const previous = stateRef.current;

    if (next.session) {
      if (shownSession.current?.id !== next.session.id) {
        // A trade began: it takes the screen, so nothing else stays open
        // over or under it. Gameplay is held server-side until it ends.
        const run = effects.current;
        run.closeSocial();
        run.setCharacterOpen(false);
        run.setInventoryOpen(false);
        run.setMissionsOpen(false);
        // The offerable Inventory and Credits come from Play: make them current.
        run.requestAutoRefresh();
        setEnded(undefined);
      }
      shownSession.current = {
        id: next.session.id,
        counterpartName: next.session.counterpart.name,
      };
    } else if (shownSession.current) {
      const shown = shownSession.current;
      shownSession.current = undefined;
      if (next.ended?.id === shown.id) {
        // A trade the player canceled just closes; anything else is explained.
        if (!next.ended.canceledByYou) {
          setEnded({
            counterpartName: next.ended.counterpart.name,
            outcome: next.ended.outcome,
            ...(next.ended.exchange ? { exchange: next.ended.exchange } : {}),
          });
        }
        if (next.ended.outcome === "completed") effects.current.requestAutoRefresh();
      } else {
        setEnded({ counterpartName: shown.counterpartName, outcome: "ended" });
      }
    }

    const lapsed = previous?.outgoing;
    if (next.outgoing) {
      setRequestNote(undefined);
    } else if (lapsed && !next.session) {
      const text = endedRequestNote(lapsed.counterpart.name, requestChanges.current.get(lapsed.id));
      setRequestNote(text ? { name: lapsed.counterpart.name, text } : undefined);
    }

    stateRef.current = next;
    setState(next);
  }, []);

  const refresh = useCallback(() => {
    const sequence = ++issued.current;
    void readTradeState(characterId).then((result) => {
      if ("state" in result) {
        apply(sequence, result.state);
      } else if (result.code === GAMEPLAY_ACCESS_REQUIRED_CODE) {
        routerRef.current.replace("/characters");
      }
      // Any other failed read leaves what is shown; the next prompt re-reads.
    });
  }, [apply, characterId]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => onReconcile(() => refresh()), [onReconcile, refresh]);
  useEffect(
    () =>
      subscribe("trade.request", ({ requestId, change }) => {
        requestChanges.current.set(requestId, change);
        refresh();
      }),
    [refresh, subscribe],
  );
  useEffect(() => subscribe("trade.session", () => refresh()), [refresh, subscribe]);
  // A Block on another tab hides that account's requests here too.
  useEffect(() => subscribe("safety.blocks", () => refresh()), [refresh, subscribe]);

  // Expiry is derived, never published: re-read just after the next pending
  // request or the session would lapse. A clock ahead of the server's only
  // means an extra read.
  useEffect(() => {
    if (!state) return;
    const deadlines = [
      state.outgoing?.expiresAt,
      ...state.incoming.map((request) => request.expiresAt),
      state.session?.expiresAt,
    ]
      .filter((value) => value !== undefined)
      .map((value) => Date.parse(value));
    if (deadlines.length === 0) return;
    const delay =
      Math.max(MIN_LAPSE_DELAY_MS, Math.min(...deadlines) - Date.now()) + LAPSE_GRACE_MS;
    const timer = window.setTimeout(refresh, delay);
    return () => window.clearTimeout(timer);
  }, [refresh, state]);

  /** Run one trade command and apply its answer; a refusal re-reads. */
  const run = useCallback(
    async (command: () => Promise<PlayerTradeActionResult>): Promise<TradeCommandError> => {
      const sequence = ++issued.current;
      let result: PlayerTradeActionResult;
      try {
        result = await command();
      } catch {
        refresh();
        return CONNECTION_ERROR;
      }
      if (!("status" in result) || result.status === "refused") {
        if ("reason" in result && result.reason === "socially_restricted") refreshNotices();
        // The answer carries no state; re-read what the server now holds.
        refresh();
        return result.error;
      }
      apply(sequence, result.state);
      return undefined;
    },
    [apply, refresh, refreshNotices],
  );

  const requestTrade = useCallback(
    (characterName: string) => {
      setRequestNote(undefined);
      return run(() => createTradeRequestAction({ characterId, target: { name: characterName } }));
    },
    [characterId, run],
  );

  const cancelRequest = useCallback(() => {
    const outgoing = stateRef.current?.outgoing;
    if (!outgoing) return Promise.resolve(undefined);
    // The player withdrew it; no note is owed.
    requestChanges.current.set(outgoing.id, "canceled");
    return run(() => cancelTradeRequestAction({ characterId, requestId: outgoing.id }));
  }, [characterId, run]);

  const acceptRequest = useCallback(
    (requestId: string) => run(() => acceptTradeRequestAction({ characterId, requestId })),
    [characterId, run],
  );

  const declineRequest = useCallback(
    (requestId: string) => run(() => declineTradeRequestAction({ characterId, requestId })),
    [characterId, run],
  );

  const session = useMemo<SessionCommands>(() => {
    /** The session and the exact version the player is looking at. */
    const target = () => {
      const current = stateRef.current?.session;
      return current
        ? { characterId, sessionId: current.id, offerVersion: current.offerVersion }
        : undefined;
    };
    const onSession = (
      command: (base: NonNullable<ReturnType<typeof target>>) => Promise<PlayerTradeActionResult>,
    ) => {
      const base = target();
      return base ? run(() => command(base)) : Promise.resolve("That trade is no longer open.");
    };
    return {
      setCredits: (credits) =>
        onSession((base) => setTradeOfferCreditsAction({ ...base, credits })),
      addStack: (itemId, quantity) =>
        onSession((base) => addTradeOfferStackAction({ ...base, itemId, quantity })),
      removeStack: (itemId, quantity) =>
        onSession((base) => removeTradeOfferStackAction({ ...base, itemId, quantity })),
      addItem: (itemInstanceId) =>
        onSession((base) => addTradeOfferItemAction({ ...base, itemInstanceId })),
      removeItem: (itemInstanceId) =>
        onSession((base) => removeTradeOfferItemAction({ ...base, itemInstanceId })),
      ready: () => onSession((base) => readyTradeOfferAction(base)),
      changeOffer: () => onSession((base) => changeTradeOfferAction(base)),
      confirm: () => onSession((base) => confirmTradeAction(base)),
      cancel: () =>
        onSession(({ sessionId }) => cancelTradeSessionAction({ characterId, sessionId })),
    };
  }, [characterId, run]);

  // Mirror the requests into the pinned Chat/Social card region. The shell's
  // setters change identity with its state, so read them through a ref.
  const cards = useRef({ upsertCard, removeCard });
  cards.current = { upsertCard, removeCard };
  const cardKeys = useRef(new Set<string>());
  useEffect(() => {
    const { upsertCard: upsert, removeCard: remove } = cards.current;
    const keys = new Set<string>();
    for (const request of state?.incoming ?? []) {
      const key = `${INCOMING_CARD_PREFIX}${request.id}`;
      keys.add(key);
      upsert({
        key,
        label: `Trade request from ${request.counterpart.name}`,
        content: <IncomingTradeRequestCard request={request} />,
      });
    }
    if (state?.outgoing && !state.session) {
      const key = `${OUTGOING_CARD_PREFIX}${state.outgoing.id}`;
      keys.add(key);
      upsert({
        key,
        label: `Your trade request to ${state.outgoing.counterpart.name}`,
        content: <OutgoingTradeRequestCard request={state.outgoing} />,
        // The player's own waiting request is shown, never announced.
        attention: false,
      });
    }
    for (const key of cardKeys.current) if (!keys.has(key)) remove(key);
    cardKeys.current = keys;
  }, [state]);

  const value = useMemo<PlayerTradeContextValue>(
    () => ({
      state,
      ended,
      dismissEnded: () => setEnded(undefined),
      requestNote,
      requestTrade,
      cancelRequest,
      acceptRequest,
      declineRequest,
      session,
    }),
    [
      acceptRequest,
      cancelRequest,
      declineRequest,
      ended,
      requestNote,
      requestTrade,
      session,
      state,
    ],
  );

  return <PlayerTradeContext.Provider value={value}>{children}</PlayerTradeContext.Provider>;
}

export function usePlayerTrade() {
  const context = useContext(PlayerTradeContext);
  if (!context) throw new Error("Player trading is unavailable");
  return context;
}
