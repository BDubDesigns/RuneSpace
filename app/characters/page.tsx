import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { ActionLink } from "@/components/ui/ActionLink";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SignOutButton } from "@/features/auth/SignOutButton";
import { ManageCharacterPortrait } from "@/features/characters/ManageCharacterPortrait";
import { auth } from "@/server/auth";
import { ensurePlayerAccount, requireCurrentUser } from "@/server/ownership";
import { listCharacters, occupiedSlots } from "@/server/characters";
import { SLOT_MIN, SLOT_MAX } from "@/db/rune-space";
import {
  getSelectablePortraitOptions,
  resolveCharacterPortrait,
} from "@/game/domain/character-portrait";
import { loadPlayerPortraitUnlockIds } from "@/server/player-portrait-unlocks";

export const metadata = { title: "Characters — RuneSpace" };

/**
 * Protected character-selection screen.
 *
 * Server-authoritative entry: authenticate the session, resolve (or create) the
 * 1:1 player account, then list the three slots. A foreign character ID can
 * never appear because we only query through the authenticated account.
 *
 * Each owned character row shows its portrait presentation (the selected
 * catalog portrait or the neutral placeholder for legacy/unowned characters)
 * and the Choose/Change portrait flow; picker options and presentation are
 * projected from the authenticated player's account unlocks.
 */
export default async function CharactersPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");

  const user = await requireCurrentUser(await headers());
  const account = await ensurePlayerAccount(user.id);
  const [chars, used, ownedPortraitIds] = await Promise.all([
    listCharacters(account.id),
    occupiedSlots(account.id),
    loadPlayerPortraitUnlockIds(account.id),
  ]);
  const portraitOptions = getSelectablePortraitOptions(ownedPortraitIds);

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
        {slots.map(({ slot, character }) => {
          const portrait =
            character === null
              ? null
              : resolveCharacterPortrait(character.portraitId, ownedPortraitIds);
          return (
            <Panel key={slot} as="li" className="p-4" tone="raised">
              {character && portrait ? (
                <div className="flex items-center gap-4">
                  {/* The portrait itself is the edit control: one accessible
                      button (large portrait/placeholder + top-right pencil)
                      opens the shared chooser. Play is the only large textual
                      action on the card. */}
                  <ManageCharacterPortrait
                    characterId={character.id}
                    characterName={character.displayName}
                    currentPortraitId={character.portraitId}
                    options={portraitOptions}
                    presentation={portrait}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                      Slot {slot}
                    </p>
                    <p className="truncate font-medium text-[color:var(--rs-text-primary)]">
                      {character.displayName}
                    </p>
                    <p className="truncate text-xs text-[color:var(--rs-text-muted)]">
                      {portrait.kind === "selected" ? portrait.displayName : "No portrait yet"}
                    </p>
                  </div>
                  <ActionLink className="shrink-0" href={`/play/${character.id}`}>
                    Play
                  </ActionLink>
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                    Slot {slot}
                  </p>
                  <p className="italic text-[color:var(--rs-text-muted)]">Empty</p>
                </div>
              )}
            </Panel>
          );
        })}
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
