import { NextResponse } from "next/server";
import { getCharacterProfile, ProfileError } from "@/server/character-profile";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";

/**
 * Authenticated read for one other character's public profile at the active
 * character's current location (issue #64). A plain route-handler GET —
 * deliberately not a server action for the same reason as the #62 population
 * read: server-action responses carry flight revalidation that can corrupt
 * the Next.js Router when a read fires during error-boundary recovery, and a
 * read needs no mutation semantics.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const characterId = url.searchParams.get("characterId");
  const targetName = url.searchParams.get("targetName");
  if (!characterId || !targetName) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const profile = await getCharacterProfile(user.id, characterId, targetName);
    return NextResponse.json({ profile }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof OwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ProfileError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
