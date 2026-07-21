"use client";

export function PlayBoundaryTestTrigger({ testMode }: { testMode: boolean }) {
  if (testMode && window.sessionStorage.getItem("runespace-e2e-play-error") === "1")
    throw new Error("Play boundary e2e failure");
  return null;
}
