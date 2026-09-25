import { NextResponse } from "next/server";
import { getLocationPopulation } from "@/server/location-population";
import { GameplayAccessError } from "@/server/gameplay-access";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";

/**
 * Authenticated read for the characters at the active character's current
 * location (issue #62). This is a plain route-handler GET — deliberately not a
 * server action: server-action responses carry flight revalidation that can
 * corrupt the Next.js Router when a read fires during error-boundary recovery,
 * and a read needs no mutation semantics.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const characterId = new URL(request.url).searchParams.get("characterId");
  if (!characterId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const result = await getLocationPopulation(user.id, characterId);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof GameplayAccessError) {
      // Issue #223: the account may not read gameplay state right now; the
      // stable code lets an already-open Play page recover to Characters.
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
