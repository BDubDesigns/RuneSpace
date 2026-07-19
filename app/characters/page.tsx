import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
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
        <SectionHeader eyebrow="Character selection">Characters</SectionHeader>
        <SignOutButton />
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Signed in as <span className="text-[color:var(--rs-text-primary)]">{user.email}</span>.
      </p>

      <ul className="mt-6 space-y-3">
        {slots.map(({ slot, character }) => (
          <Panel key={slot} as="li" className="flex items-center justify-between p-4" tone="raised">
            <div>
              <p className="font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                Slot {slot}
              </p>
              {character ? (
                <p className="font-medium text-[color:var(--rs-text-primary)]">
                  {character.displayName}
                </p>
              ) : (
                <p className="italic text-[color:var(--rs-text-muted)]">Empty</p>
              )}
            </div>
            {character ? <ActionLink href={`/play/${character.id}`}>Play</ActionLink> : null}
          </Panel>
        ))}
      </ul>

      {hasFreeSlot ? (
        <ActionLink href="/characters/new" intent="secondary" className="mt-6 flex w-full">
          New character
        </ActionLink>
      ) : (
        <p className="mt-6 text-center text-sm text-[color:var(--rs-text-muted)]">
          All character slots are full.
        </p>
      )}
    </ScaffoldScreen>
  );
}
