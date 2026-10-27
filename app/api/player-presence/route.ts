import { NextResponse } from "next/server";
import { z } from "zod";
import { checkInPlayer, getPlayersOnline } from "@/server/player-presence";
import { GameplayAccessError } from "@/server/gameplay-access";
import { OwnershipError, requireCurrentUser } from "@/server/ownership";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };

export async function GET() {
  try {
    return NextResponse.json({ count: await getPlayersOnline() }, { headers: noStore });
  } catch {
    return NextResponse.json(
      { error: "Players online unavailable." },
      { status: 503, headers: noStore },
    );
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    fetchSite === "cross-site" ||
    fetchSite === "same-site"
  ) {
    return new NextResponse(null, { status: 403, headers: noStore });
  }
  const characterId = new URL(request.url).searchParams.get("characterId");
  if (!z.string().uuid().safeParse(characterId).success || !characterId) {
    return new NextResponse(null, { status: 400, headers: noStore });
  }
  try {
    const user = await requireCurrentUser(request.headers);
    const accepted = await checkInPlayer(user.id, characterId);
    return new NextResponse(null, { status: accepted ? 204 : 429, headers: noStore });
  } catch (error) {
    if (error instanceof GameplayAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: noStore },
      );
    }
    if (error instanceof OwnershipError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: noStore },
      );
    }
    throw error;
  }
}
