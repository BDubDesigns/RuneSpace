"use client";

import {
  createContext,
  useEffect,
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import type { MiningGameplayState } from "@/server/mining";
import { cancelRefresh, tryAcquire, release, requestRefresh, type GateModel } from "./command-gate";

type MiningPlayContextValue = {
  inventoryOpen: boolean;
  inventoryTrigger: RefObject<HTMLButtonElement | null>;
  equipmentOpen: boolean;
  equipmentTrigger: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  acquireCommand: () => boolean;
  releaseCommand: () => void;
  requestAutoRefresh: (schedulerToken?: number) => void;
  setRefreshCallback: (fn: () => void) => void;
  setInventoryOpen: Dispatch<SetStateAction<boolean>>;
  setEquipmentOpen: Dispatch<SetStateAction<boolean>>;
  acceptState: (nextState: MiningGameplayState) => void;
  state: MiningGameplayState;
};

const MiningPlayContext = createContext<MiningPlayContextValue | undefined>(undefined);

const BOUNDARY_REFRESH_RETRY_DELAYS_MS = [250, 500, 1_000, 1_500, 2_000] as const;
const BOUNDARY_REFRESH_GRACE_MS = 150;

function boundaryKeyForState(state: MiningGameplayState): string | undefined {
  return state.travelState
    ? `travel:${state.travelState.originLocationId}:${state.travelState.destinationLocationId}:${state.travelState.arrivesAt}`
    : state.activeAction
      ? `action:${state.activeAction.actionId}:${state.activeAction.nextAttemptAt}`
      : undefined;
}

export function MiningPlayProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState: MiningGameplayState;
}) {
  const [state, setState] = useState(initialState);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [equipmentOpen, setEquipmentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inventoryTrigger = useRef<HTMLButtonElement>(null);
  const equipmentTrigger = useRef<HTMLButtonElement>(null);
  const gateModel = useRef<GateModel>({ locked: false, pending: false });
  const refreshCallback = useRef<() => void>(undefined);
  const boundaryGeneration = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const acquireCommand = useCallback(() => {
    const ok = tryAcquire(gateModel.current);
    if (ok) setBusy(true);
    return ok;
  }, []);

  const releaseCommand = useCallback(() => {
    setBusy(false);
    const pendingToken = gateModel.current.pendingToken;
    if (release(gateModel.current)) {
      if (pendingToken !== undefined && pendingToken !== boundaryGeneration.current) return;
      refreshCallback.current?.();
    }
  }, []);

  const requestAutoRefresh = useCallback((schedulerToken?: number) => {
    if (schedulerToken !== undefined && schedulerToken !== boundaryGeneration.current) return;
    if (requestRefresh(gateModel.current, schedulerToken)) {
      refreshCallback.current?.();
    }
  }, []);

  const setRefreshCallback = useCallback((fn: () => void) => {
    refreshCallback.current = fn;
  }, []);

  const acceptState = useCallback((nextState: MiningGameplayState) => {
    if (boundaryKeyForState(stateRef.current) !== boundaryKeyForState(nextState)) {
      // Invalidate synchronously. React effect cleanup runs after this command's
      // promise continuation, so cleanup alone is too late to stop release()
      // from launching a stale coalesced refresh.
      cancelRefresh(gateModel.current, boundaryGeneration.current);
      boundaryGeneration.current += 1;
    }
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  // One bounded scheduler owns the play boundary for both Mining and Travel.
  // The display clocks remain in their feature components, but reconciliation
  // must survive a request that arrives just before the server's whole-tick
  // deadline and returns the same authoritative timestamp.
  const boundaryKey = boundaryKeyForState(state);
  const boundaryAt = state.travelState?.arrivesAt ?? state.activeAction?.nextAttemptAt;

  useEffect(() => {
    if (!boundaryKey || !boundaryAt) return;
    const boundaryTime = new Date(boundaryAt).getTime();
    if (!Number.isFinite(boundaryTime)) return;

    const schedulerToken = boundaryGeneration.current + 1;
    boundaryGeneration.current = schedulerToken;
    let retryIndex = 0;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        requestAutoRefresh(schedulerToken);
        const retryDelay = BOUNDARY_REFRESH_RETRY_DELAYS_MS[retryIndex];
        if (retryDelay !== undefined) {
          retryIndex += 1;
          schedule(retryDelay);
        }
      }, delay);
    };

    schedule(Math.max(100, boundaryTime - Date.now() + BOUNDARY_REFRESH_GRACE_MS));
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      cancelRefresh(gateModel.current, schedulerToken);
      if (boundaryGeneration.current === schedulerToken) boundaryGeneration.current += 1;
    };
  }, [boundaryAt, boundaryKey, requestAutoRefresh]);

  return (
    <MiningPlayContext.Provider
      value={{
        inventoryOpen,
        inventoryTrigger,
        equipmentOpen,
        equipmentTrigger,
        busy,
        acquireCommand,
        releaseCommand,
        requestAutoRefresh,
        setRefreshCallback,
        setInventoryOpen,
        setEquipmentOpen,
        acceptState,
        state,
      }}
    >
      {children}
    </MiningPlayContext.Provider>
  );
}

export function useMiningPlay() {
  const context = useContext(MiningPlayContext);
  if (!context) throw new Error("Mining play state is unavailable");
  return context;
}
