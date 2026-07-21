import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MiningPlayScreen } from "@/features/mining/MiningPlayScreen";
import { auth } from "@/server/auth";
import { requireCurrentUser, requireOwnedCharacter, OwnershipError } from "@/server/ownership";
import { getMiningGameplayState } from "@/server/mining";

export const metadata = { title: "Play — RuneSpace" };

/**
 * Protected placeholder screen for a single owned character.
 *
 * Every access re-authenticates the session and verifies, server-side, that the
 * requested character belongs to the authenticated user. Changing the URL to
 * another user's character ID yields a 404-style redirect — never another
 * player's data.
 */
export default async function PlayPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  let displayName = "Character";
  let miningState;
  try {
    const user = await requireCurrentUser(await headers());
    const character = await requireOwnedCharacter(user.id, characterId);
    displayName = character.displayName;
    miningState = await getMiningGameplayState(user.id, characterId);
  } catch (err) {
    if (err instanceof OwnershipError) redirect("/characters");
    throw err;
  }

  return <MiningPlayScreen characterName={displayName} initialState={miningState!} />;
}
