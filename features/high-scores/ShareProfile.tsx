"use client";

import { useState } from "react";

export function ShareProfile({ name }: { name: string }) {
  const [message, setMessage] = useState("");
  async function share() {
    setMessage("");
    const url = `${window.location.origin}/high-scores/characters/${encodeURIComponent(name)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${name} | RuneSpace`, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Profile link copied.");
    } catch {
      setMessage("Could not copy the link. You can copy the address from your browser.");
    }
  }
  return (
    <div>
      <button
        className="rs-focus min-h-11 border border-[color:var(--rs-border-structural)] px-4 font-semibold"
        onClick={share}
        type="button"
      >
        Share
      </button>
      <p aria-live="polite" className="mt-2 text-sm">
        {message}
      </p>
    </div>
  );
}
