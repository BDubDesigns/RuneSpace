import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GameShell, TopBar } from "@/components/ui/GameShell";
import { TextLink } from "@/components/ui/TextLink";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { MiningConsole } from "@/features/mining/MiningConsole";
import { auth } from "@/server/auth";
import { requireCurrentUser, requireOwnedCharacter, OwnershipError } from "@/server/ownership";
import { getMiningGameplayState } from "@/server/mining";

export const metadata = { title: "Play — RuneSpace" };

function shouldInjectE2ePlayError(requestHeaders: Headers) {
  const databaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";
  return (
    process.env.CI === "true" &&
    process.env.RUNESPACE_E2E_PLAY_ERROR === "true" &&
    (databaseHost === "localhost" || databaseHost === "127.0.0.1") &&
    requestHeaders.get("x-runespace-e2e-play-error") === "1"
  );
}

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
  if (shouldInjectE2ePlayError(await headers())) throw new Error("Play boundary e2e failure");

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

  return (
    <GameShell
      topBar={
        <div className="flex items-center justify-between gap-3">
          <TopBar title="RuneSpace" detail="Crash Site Mining" />
          <SignOutButton />
        </div>
      }
      aside={
        <p className="text-sm text-[color:var(--rs-text-secondary)]">
          <TextLink href="/characters">Back to characters</TextLink>
        </p>
      }
    >
      <MiningConsole characterName={displayName} initialState={miningState!} />
    </GameShell>
  );
}
