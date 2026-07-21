"use client";

import { useEffect, useState } from "react";

export function PlayBoundaryTestTrigger() {
  const [shouldThrow, setShouldThrow] = useState(false);
  useEffect(() => {
    if (
      process.env.NEXT_PUBLIC_RUNESPACE_E2E_PLAY_ERROR === "true" &&
      window.sessionStorage.getItem("runespace-e2e-play-error") === "1"
    )
      setShouldThrow(true);
  }, []);
  if (shouldThrow) throw new Error("Play boundary e2e failure");
  return null;
}
