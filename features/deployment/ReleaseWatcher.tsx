"use client";

import { useEffect, useRef, useState } from "react";
import {
  RELEASE_POLL_INTERVAL_MS,
  captureDocumentRelease,
  claimReload,
  editingText,
  fetchLiveRelease,
} from "./release-watch";

const DEFERRAL_RECHECK_MS = 1_000;

function reloadStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Loads a newer deployment into an already-open tab (issue #412). It renders
 * nothing. While the tab is visible it asks `/api/build-info` once a minute,
 * and immediately when the tab becomes visible again or the browser comes back
 * online. When the live release differs from the one that served this document
 * it performs a real document reload, never `router.refresh()`, which would
 * keep running the old JavaScript.
 *
 * Gameplay is server-authoritative, so a reload only throws away presentation:
 * Mining, Refining, Travel and the rest are rebuilt from the server on load.
 * The reload waits while `shouldDefer` says a time-sensitive interaction is
 * open and while the player is mid-sentence, and it is attempted once per
 * target release per cooldown, so a rollout that never converges cannot loop.
 * Failed checks and an unknown identity on either side change nothing.
 */
export function ReleaseWatcher({
  releaseId,
  shouldDefer,
}: {
  /** The server's runtime release as rendered into this page. */
  releaseId: string | undefined;
  shouldDefer?: () => boolean;
}) {
  const [own] = useState(() => captureDocumentRelease(releaseId));
  const [target, setTarget] = useState<{ release: string; seenAt: number }>();
  const deferRef = useRef(shouldDefer);
  deferRef.current = shouldDefer;

  useEffect(() => {
    if (!own) return;
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        const live = await fetchLiveRelease();
        if (stopped || !live) return;
        setTarget(live === own ? undefined : { release: live, seenAt: Date.now() });
      } finally {
        checking = false;
      }
    };
    const onVisibility = () => void check();
    const timer = window.setInterval(() => void check(), RELEASE_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onVisibility);
    };
  }, [own]);

  useEffect(() => {
    if (!target) return;
    let timer: number | undefined;
    const attempt = () => {
      if (deferRef.current?.() || editingText()) {
        timer = window.setTimeout(attempt, DEFERRAL_RECHECK_MS);
        return;
      }
      if (claimReload(reloadStorage(), target.release, Date.now())) window.location.reload();
    };
    attempt();
    return () => window.clearTimeout(timer);
  }, [target]);

  return null;
}
