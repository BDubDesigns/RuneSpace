import { NextResponse } from "next/server";
import { ChatMentionsQuerySchema } from "@/game/schemas/chat";
import { readChatMentions } from "@/server/chat";
import { GameplayAccessError } from "@/server/gameplay-access";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";

/**
 * Authenticated read of the active character's unread public `@mentions`
 * (issue #261), per channel and in total. Also the reconcile path after the
 * realtime stream (re)opens, a mention commits, or another tab reads one.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = ChatMentionsQuerySchema.safeParse({ characterId: params.get("characterId") });
  if (!query.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const result = await readChatMentions(user.id, query.data.characterId);
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
