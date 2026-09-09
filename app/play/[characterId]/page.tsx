import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PlayScreen } from "@/features/play/PlayScreen";
import { auth } from "@/server/auth";
import {
  requireCurrentUser,
  requireOwnedCharacter,
  requirePlayerAccount,
  OwnershipError,
} from "@/server/ownership";
import { getPlayGameplayState } from "@/server/play";
import { getAccountNewsUnread } from "@/server/account-news";

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
  let playState;
  let newsUnread = false;
  try {
    const user = await requireCurrentUser(await headers());
    const character = await requireOwnedCharacter(user.id, characterId);
    displayName = character.displayName;
    playState = await getPlayGameplayState(user.id, characterId);
    // Account-level (issue #156): derived from the same player account for
    // every character, never from this specific character.
    const account = await requirePlayerAccount(user.id);
    newsUnread = getAccountNewsUnread(account);
  } catch (err) {
    if (err instanceof OwnershipError) redirect("/characters");
    throw err;
  }

  return (
    <PlayScreen characterName={displayName} initialState={playState!} newsUnread={newsUnread} />
  );
}
