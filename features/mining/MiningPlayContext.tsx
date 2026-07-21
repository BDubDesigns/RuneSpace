"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import type { MiningGameplayState } from "@/server/mining";

type MiningPlayContextValue = {
  inventoryOpen: boolean;
  inventoryTrigger: RefObject<HTMLButtonElement | null>;
  setInventoryOpen: Dispatch<SetStateAction<boolean>>;
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
  const inventoryTrigger = useRef<HTMLButtonElement>(null);
  return (
    <MiningPlayContext.Provider
      value={{ inventoryOpen, inventoryTrigger, setInventoryOpen, setState, state }}
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
