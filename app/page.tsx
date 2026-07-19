import { headers } from "next/headers";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { ActionLink } from "@/components/ui/ActionLink";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { auth } from "@/server/auth";

/**
 * Landing / smoke screen.
 *
 * Intentionally minimal. It identifies RuneSpace and routes signed-in players to
 * their characters and signed-out visitors to registration. It does NOT contain
 * any gameplay, lore, quests, NPCs, resources, balance values, or
 * interactions. Those arrive in later issues, server-authoritatively.
 */
export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <ScaffoldScreen>
      <SectionHeader eyebrow="Development build">RuneSpace</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Development scaffold online.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-[color:var(--rs-text-muted)]">
        Systems initializing. This is an early foundation build, not a playable game. Architecture,
        tooling, and tests are being established before gameplay work begins.
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
