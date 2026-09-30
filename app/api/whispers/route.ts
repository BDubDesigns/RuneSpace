import { NextResponse } from "next/server";
import { WhisperInboxQuerySchema } from "@/game/schemas/whispers";
import { GameplayAccessError } from "@/server/gameplay-access";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";
import { readWhisperInbox } from "@/server/whispers";

/**
 * Authenticated read of the active character's Whisper conversations and
 * durable unread counts (issue #247). A plain route-handler GET like the other
 * gameplay reads; it is also the reconcile path after the realtime stream
 * (re)opens or another tab reads a conversation.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = WhisperInboxQuerySchema.safeParse({ characterId: params.get("characterId") });
  if (!query.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const result = await readWhisperInbox(user.id, query.data.characterId);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
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
