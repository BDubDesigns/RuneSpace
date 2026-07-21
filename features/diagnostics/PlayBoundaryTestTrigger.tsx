"use client";

export function PlayBoundaryTestTrigger({ enabled }: { enabled: boolean }) {
  if (enabled) throw new Error("Play boundary e2e failure");
  return null;
}
