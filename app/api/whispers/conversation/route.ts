import { NextResponse } from "next/server";
import { WhisperHistoryQuerySchema } from "@/game/schemas/whispers";
import { GameplayAccessError } from "@/server/gameplay-access";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";
import { readWhisperHistory, WhisperError } from "@/server/whispers";

/**
 * Authenticated read of one Whisper conversation page (issue #247): the latest
 * page with another character, or with `before` the page older than a message.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = WhisperHistoryQuerySchema.safeParse({
    characterId: params.get("characterId"),
    withCharacterId: params.get("withCharacterId"),
    before: params.get("before") ?? undefined,
  });
  if (!query.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const { characterId, ...page } = query.data;
    const result = await readWhisperHistory(user.id, characterId, page);
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
    if (error instanceof WhisperError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
