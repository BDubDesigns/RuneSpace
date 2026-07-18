import Link from "next/link";
import { headers } from "next/headers";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
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
      <h1 className="font-mono text-2xl font-bold tracking-tight text-emerald-400 sm:text-3xl">
        RuneSpace
      </h1>
      <p className="mt-2 text-sm text-slate-400">Development scaffold online.</p>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Systems initializing. This is an early foundation build, not a playable game. Architecture,
        tooling, and tests are being established before gameplay work begins.
      </p>
      <div className="mt-6 flex gap-3">
        {session?.user ? (
          <Link
            href="/characters"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
          >
            My characters
          </Link>
        ) : (
          <>
            <Link
              href="/register"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
            >
              Register
            </Link>
            <Link
              href="/sign-in"
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-emerald-500"
            >
              Sign in
            </Link>
          </>
        )}
      </div>
    </ScaffoldScreen>
  );
}
