import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { auth } from "@/server/auth";
import { ensurePlayerAccount, requireCurrentUser } from "@/server/ownership";
import { listCharacters, occupiedSlots } from "@/server/characters";
import { SLOT_MIN, SLOT_MAX } from "@/db/rune-space";

export const metadata = { title: "Characters — RuneSpace" };

/**
 * Protected character-selection screen.
 *
 * Server-authoritative entry: authenticate the session, resolve (or create) the
 * 1:1 player account, then list the three slots. A foreign character ID can
 * never appear because we only query through the authenticated account.
 */
export default async function CharactersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  const user = await requireCurrentUser(await headers());
  const account = await ensurePlayerAccount(user.id);
  const [chars, used] = await Promise.all([listCharacters(account.id), occupiedSlots(account.id)]);

  const slots = [];
  for (let slot = SLOT_MIN; slot <= SLOT_MAX; slot++) {
    const character = chars.find((c) => c.slot === slot) ?? null;
    slots.push({ slot, character });
  }
  const hasFreeSlot = used.size < SLOT_MAX;

  return (
    <ScaffoldScreen>
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-2xl font-bold tracking-tight text-emerald-400">Characters</h1>
        <SignOutButton />
      </div>
      <p className="mt-2 text-sm text-slate-400">
        Signed in as <span className="text-slate-200">{user.email}</span>.
      </p>

      <ul className="mt-6 space-y-3">
        {slots.map(({ slot, character }) => (
          <li
            key={slot}
            className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3"
          >
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Slot {slot}</p>
              {character ? (
                <p className="font-medium text-slate-100">{character.displayName}</p>
              ) : (
                <p className="italic text-slate-600">Empty</p>
              )}
            </div>
            {character ? (
              <Link
                href={`/play/${character.id}`}
                className="rounded-lg bg-emerald-500 px-3 py-1 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
              >
                Play
              </Link>
            ) : null}
          </li>
        ))}
      </ul>

      {hasFreeSlot ? (
        <Link
          href="/characters/new"
          className="mt-6 block w-full rounded-lg border border-emerald-500 px-4 py-2 text-center text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/10"
        >
          New character
        </Link>
      ) : (
        <p className="mt-6 text-center text-sm text-slate-500">All character slots are full.</p>
      )}
    </ScaffoldScreen>
  );
}
