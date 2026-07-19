import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TextLink } from "@/components/ui/TextLink";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { auth } from "@/server/auth";
import { requireCurrentUser, requireOwnedCharacter, OwnershipError } from "@/server/ownership";

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
  try {
    const user = await requireCurrentUser(await headers());
    const character = await requireOwnedCharacter(user.id, characterId);
    displayName = character.displayName;
  } catch (err) {
    if (err instanceof OwnershipError) redirect("/characters");
    throw err;
  }

  return (
    <ScaffoldScreen>
      <div className="flex items-center justify-between">
        <SectionHeader eyebrow="Protected character">{displayName}</SectionHeader>
        <SignOutButton />
      </div>
      <p className="mt-4 text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
        This is a protected placeholder. Gameplay, maps, and the rest of the world arrive in later
        issues. Your session and character ownership are verified server-side on every request.
      </p>
      <p className="mt-6 text-sm text-[color:var(--rs-text-secondary)]">
        <TextLink href="/characters">Back to characters</TextLink>
      </p>
    </ScaffoldScreen>
  );
}
