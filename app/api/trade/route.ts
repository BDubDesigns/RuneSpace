import { NextResponse } from "next/server";
import { TradeStateQuerySchema } from "@/game/schemas/player-trade";
import { GameplayAccessError } from "@/server/gameplay-access";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";
import { getTradeState } from "@/server/player-trades";

/**
 * Authenticated read of the active character's trade state (issue #266): its
 * pending outgoing request, the pending requests it has received, and its
 * active session. A plain route-handler GET like the other gameplay reads; it
 * is also the reconcile path after the realtime stream (re)opens or a
 * `trade.request` / `trade.session` prompt arrives.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = TradeStateQuerySchema.safeParse({ characterId: params.get("characterId") });
  if (!query.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const result = await getTradeState(user.id, query.data.characterId);
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
