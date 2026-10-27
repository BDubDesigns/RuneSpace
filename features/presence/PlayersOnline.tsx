"use client";

import { useEffect, useState } from "react";

export function PlayersOnline() {
  const [count, setCount] = useState<number>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let inFlight: AbortController | undefined;
    let lastSuccess = 0;
    async function refresh() {
      if (inFlight) return;
      const controller = new AbortController();
      inFlight = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/api/player-presence", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("unavailable");
        const body: unknown = await response.json();
        if (
          !body ||
          typeof body !== "object" ||
          !("count" in body) ||
          typeof body.count !== "number" ||
          !Number.isSafeInteger(body.count) ||
          body.count < 0
        )
          throw new Error("invalid count");
        if (active) {
          setCount(body.count);
          setFailed(false);
          lastSuccess = Date.now();
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        window.clearTimeout(timeout);
        if (inFlight === controller) inFlight = undefined;
      }
    }
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (lastSuccess && Date.now() - lastSuccess > 120_000) setFailed(true);
      void refresh();
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      inFlight?.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return (
    <p aria-live="polite" className="text-sm font-semibold text-[color:var(--rs-text-secondary)]">
      {count === undefined ? (
        failed ? (
          "Players online unavailable"
        ) : (
          "Loading players online…"
        )
      ) : (
        <>
          {count.toLocaleString()} {count === 1 ? "player" : "players"} online
          {failed ? " (last known; update unavailable)" : ""}
        </>
      )}
    </p>
  );
}
