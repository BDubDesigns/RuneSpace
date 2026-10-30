import { getPlayersOnline } from "@/server/player-presence";

/** One aggregate assertion, only when explicitly invoked by the protected route. */
export async function reportScapelikesPresence(siteId: string, dryRun: boolean): Promise<void> {
  const count = await getPlayersOnline();
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid presence count");

  const url = new URL(
    `https://api.scapelikes.com/v1/presence/aggregate/${encodeURIComponent(siteId)}`,
  );
  if (dryRun) url.searchParams.set("dry_run", "1");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ online: count }),
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) {
    // Status only: the provider URL contains a credential; response bodies may echo it.
    console.error(`[scapelikes-presence] Provider returned HTTP ${response.status}`);
    throw new Error("Provider rejected presence report");
  }
}
