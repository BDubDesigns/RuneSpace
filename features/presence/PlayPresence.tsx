"use client";

import { useEffect } from "react";

/** Mounted only while a playable character's Play surface is open. */
export function PlayPresence({ characterId }: { characterId: string }) {
  useEffect(() => {
    const controller = new AbortController();
    const checkIn = () => {
      void fetch(`/api/player-presence?characterId=${encodeURIComponent(characterId)}`, {
        method: "POST",
        signal: controller.signal,
      }).catch(() => {});
    };
    checkIn();
    const timer = window.setInterval(checkIn, 30_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [characterId]);
  return null;
}
