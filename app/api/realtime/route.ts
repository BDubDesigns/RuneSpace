import { NextResponse } from "next/server";
import { z } from "zod";
import { GameplayAccessError } from "@/server/gameplay-access";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";
import { openRealtimeStream, REALTIME_STREAM_HEADERS } from "@/server/realtime-stream";

/**
 * The authenticated, same-origin realtime/social stream (issue #245): one
 * Server-Sent Events response per open Play tab, for the active character.
 *
 * `characterId` is the only input read; any other query parameter is ignored.
 * The session, ownership, and gameplay access are checked on every stream
 * creation, and the delivery scope is derived server-side from them. Refusals
 * mirror the other gameplay reads, including the stable
 * `GAMEPLAY_ACCESS_REQUIRED` code that sends a stale Play page to Characters.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const characterId = new URL(request.url).searchParams.get("characterId");
  if (!z.string().uuid().safeParse(characterId).success || !characterId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const { stream } = await openRealtimeStream(user.id, characterId, {
      signal: request.signal,
    });
    return new Response(stream, { headers: REALTIME_STREAM_HEADERS });
  } catch (error) {
    if (error instanceof GameplayAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { "cache-control": "no-store" } },
      );
    }
    if (error instanceof OwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
