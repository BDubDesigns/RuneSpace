"use client";

import {
  createContext,
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
import { tryAcquire, release, requestRefresh, type GateModel } from "./command-gate";

type MiningPlayContextValue = {
  inventoryOpen: boolean;
  inventoryTrigger: RefObject<HTMLButtonElement | null>;
  equipmentOpen: boolean;
  equipmentTrigger: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  acquireCommand: () => boolean;
  releaseCommand: () => void;
  requestAutoRefresh: () => void;
  setRefreshCallback: (fn: () => void) => void;
  setInventoryOpen: Dispatch<SetStateAction<boolean>>;
  setEquipmentOpen: Dispatch<SetStateAction<boolean>>;
  setState: Dispatch<SetStateAction<MiningGameplayState>>;
  state: MiningGameplayState;
};

const MiningPlayContext = createContext<MiningPlayContextValue | undefined>(undefined);

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

  const acquireCommand = useCallback(() => {
    const ok = tryAcquire(gateModel.current);
    if (ok) setBusy(true);
    return ok;
  }, []);

  const releaseCommand = useCallback(() => {
    setBusy(false);
    if (release(gateModel.current)) {
      refreshCallback.current?.();
    }
  }, []);

  const requestAutoRefresh = useCallback(() => {
    if (requestRefresh(gateModel.current)) {
      refreshCallback.current?.();
    }
  }, []);

  const setRefreshCallback = useCallback((fn: () => void) => {
    refreshCallback.current = fn;
  }, []);

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
        setState,
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
