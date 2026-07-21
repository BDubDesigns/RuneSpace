"use client";

import { useEffect, useState } from "react";

export function PlayBoundaryTestTrigger({ testMode }: { testMode: boolean }) {
  const [shouldThrow, setShouldThrow] = useState(false);
  useEffect(() => {
    if (testMode && window.sessionStorage.getItem("runespace-e2e-play-error") === "1")
      setShouldThrow(true);
  }, [testMode]);
  if (shouldThrow) throw new Error("Play boundary e2e failure");
  return null;
}
