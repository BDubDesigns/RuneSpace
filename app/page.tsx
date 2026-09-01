import { headers } from "next/headers";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { RuneSpaceBrand } from "@/components/branding/RuneSpaceBrand";
import { ActionLink } from "@/components/ui/ActionLink";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { auth } from "@/server/auth";

/**
 * Landing / smoke screen.
 *
 * Identifies RuneSpace as a playable pre-alpha and routes signed-in players
 * to their characters and signed-out visitors to registration. It does not
 * duplicate gameplay mechanics — those live behind Play.
 */
export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <ScaffoldScreen>
      <SectionHeader eyebrow="Pre-alpha — active development">
        <RuneSpaceBrand className="block h-14 w-auto sm:h-16" sizes="256px" />
      </SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Playable pre-alpha — active development.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-[color:var(--rs-text-muted)]">
        RuneSpace is a browser-first sci-fi RPG in early development. The current build has a real
        early-game loop — Travel, Mining, Refining, Welding, missions, and progression — behind a
        server-authoritative Play shell. Expect rough edges and frequent changes.
      </p>
      <div className="mt-6 flex gap-3">
        {session?.user ? (
          <ActionLink href="/characters">My characters</ActionLink>
        ) : (
          <>
            <ActionLink href="/register">Register</ActionLink>
            <ActionLink href="/sign-in" intent="secondary">
              Sign in
            </ActionLink>
          </>
        )}
      </div>
    </ScaffoldScreen>
  );
}
