"use client";

import { useRef } from "react";
import { ReleaseWatcher } from "@/features/deployment/ReleaseWatcher";
import { usePlayerTrade } from "@/features/player-trade/PlayerTradeContext";
import { usePlay } from "./PlayContext";
import { playUpdateDeferral } from "./update-deferral";

/** Binds the update watcher to Play's own notion of a time-sensitive moment. */
export function PlayReleaseWatch({ releaseId }: { releaseId: string | undefined }) {
  const { busy, serverNowMs, state } = usePlay();
  const trade = usePlayerTrade();
  const defer = useRef<() => boolean>(() => false);
  defer.current = () =>
    playUpdateDeferral({
      commandInFlight: busy,
      tradeSessionOpen: Boolean(trade.state?.session),
      state,
      serverNowMs: serverNowMs(),
    }) !== undefined;
  return <ReleaseWatcher releaseId={releaseId} shouldDefer={() => defer.current()} />;
}
