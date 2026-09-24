import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PlayScreen } from "@/features/play/PlayScreen";
import { auth } from "@/server/auth";
import { requirePlayableOwnedCharacter } from "@/server/gameplay-access";
import { requireCurrentUser, requirePlayerAccount, OwnershipError } from "@/server/ownership";
import { getPlayGameplayState } from "@/server/play";
import { getAccountNewsUnread } from "@/server/account-news";
import { loadPlayerPortraitUnlockIds } from "@/server/player-portrait-unlocks";
import {
  resolveCharacterPortrait,
  type CharacterPortraitPresentation,
} from "@/game/domain/character-portrait";

export const metadata = { title: "Play — RuneSpace" };

/**
 * Protected placeholder screen for a single owned character.
 *
 * Every access re-authenticates the session, re-checks gameplay access (issue
 * #223: verified email and public gameplay open or account Early Access), and
 * verifies, server-side, that the requested character belongs to the
 * authenticated user. An account without gameplay access, or a URL naming
 * another user's character, is redirected to Characters — never another
 * player's data and never gameplay state.
 */
export default async function PlayPage({ params }: { params: Promise<{ characterId: string }> }) {
  const { characterId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  let displayName = "Character";
  let portrait: CharacterPortraitPresentation = { kind: "placeholder" };
  let playState;
  let newsUnread = false;
  try {
    const user = await requireCurrentUser(await headers());
    const character = await requirePlayableOwnedCharacter(user.id, characterId);
    displayName = character.displayName;
    playState = await getPlayGameplayState(user.id, characterId);
    // Account-level (issue #156): derived from the same player account for
    // every character, never from this specific character.
    const account = await requirePlayerAccount(user.id);
    newsUnread = getAccountNewsUnread(account);
    // The Character surface shows the same resolved presentation the selection
    // screen and the public profile do: a selected portrait the account still
    // owns, or the neutral placeholder. The stored row is never rewritten.
    portrait = resolveCharacterPortrait(
      character.portraitId,
      await loadPlayerPortraitUnlockIds(account.id),
    );
  } catch (err) {
    if (err instanceof OwnershipError) redirect("/characters");
    throw err;
  }

  return (
    <PlayScreen
      characterName={displayName}
      characterPortrait={portrait}
      initialState={playState!}
      newsUnread={newsUnread}
    />
  );
}
