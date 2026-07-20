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

const e2eErrorTokens = new Set<string>();

function shouldInjectE2eError(token: string | undefined) {
  const databaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";
  return (
    process.env.CI === "true" &&
    process.env.RUNESPACE_E2E_PLAY_ERROR === "true" &&
    (databaseHost === "localhost" || databaseHost === "127.0.0.1") &&
    (token === "reset" || token === "navigation") &&
    !e2eErrorTokens.has(token)
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
export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ characterId: string }>;
  searchParams: Promise<{ __runespace_e2e_error?: string }>;
}) {
  const { characterId } = await params;
  const { __runespace_e2e_error: e2eErrorToken } = await searchParams;
  if (shouldInjectE2eError(e2eErrorToken)) {
    e2eErrorTokens.add(e2eErrorToken!);
    throw new Error("Play boundary e2e failure");
  }
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
