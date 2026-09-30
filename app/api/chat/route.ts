import { NextResponse } from "next/server";
import { ChatHistoryQuerySchema } from "@/game/schemas/chat";
import { readChatHistory } from "@/server/chat";
import { GameplayAccessError } from "@/server/gameplay-access";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";

/**
 * Authenticated read of one public chat feed page (issue #246): the latest
 * page of General or Trade, or with `before` the page older than a message.
 * A plain route-handler GET like the other gameplay reads, never a server
 * action. It is also the reconnect path: after the realtime stream (re)opens,
 * the browser re-reads here instead of trusting any replay.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = ChatHistoryQuerySchema.safeParse({
    characterId: params.get("characterId"),
    channel: params.get("channel"),
    before: params.get("before") ?? undefined,
  });
  if (!query.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const { characterId, ...page } = query.data;
    const result = await readChatHistory(user.id, characterId, page);
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
