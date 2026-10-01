import { NextResponse } from "next/server";
import { SystemNoticesQuerySchema } from "@/game/schemas/system-notices";
import { GameplayAccessError } from "@/server/gameplay-access";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";
import { readSystemNotices } from "@/server/system-notices";

/**
 * Authenticated read of the active character's System conversation — its
 * recipe-unlock notices and durable unread count (issue #274). Also the
 * reconcile path after the realtime stream (re)opens, a notice commits, or
 * another tab reads System.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = SystemNoticesQuerySchema.safeParse({ characterId: params.get("characterId") });
  if (!query.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const result = await readSystemNotices(user.id, query.data.characterId);
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
