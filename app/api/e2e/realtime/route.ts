import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocalE2eRuntime } from "@/server/local-e2e";
import { getRealtimeFanout } from "@/server/realtime";

/**
 * Local-E2E hook for the realtime substrate (issue #245), reachable ONLY
 * inside the repository's local-E2E runtime gate (`server/local-e2e.ts`);
 * everywhere else — previews and production included — it is a plain 404.
 *
 * It ends one character's open streams exactly as the bounded 5-minute
 * lifetime does, so a browser journey can prove the deliberate
 * close → reconnect path without waiting five minutes, and reports how many
 * streams it closed so a multi-tab journey can count its connections.
 */
export const dynamic = "force-dynamic";

const RequestSchema = z.object({ characterId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isLocalE2eRuntime()) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const closed = getRealtimeFanout().close(
    { kind: "character", characterId: parsed.data.characterId },
    "lifetime",
  );
  return NextResponse.json({ closed }, { headers: { "cache-control": "no-store" } });
}
