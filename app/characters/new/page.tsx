import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TextLink } from "@/components/ui/TextLink";
import { CreateCharacterForm } from "@/features/characters/CreateCharacterForm";
import { auth } from "@/server/auth";
import { ensurePlayerAccount, requireCurrentUser } from "@/server/ownership";
import { getPlayerSelectablePortraitOptions } from "@/server/player-portrait-unlocks";

export const metadata = { title: "New character — RuneSpace" };

export default async function NewCharacterPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/sign-in");
  const user = await requireCurrentUser(await headers());
  const account = await ensurePlayerAccount(user.id);
  const portraitOptions = await getPlayerSelectablePortraitOptions(account.id);

  return (
    <ScaffoldScreen size="wide">
      <SectionHeader eyebrow="Character selection">New character</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Choose a name and a portrait. Names are unique after normalization; you get three slots.
      </p>
      <CreateCharacterForm options={portraitOptions} />
      <p className="mt-6 text-sm text-[color:var(--rs-text-secondary)]">
        <TextLink href="/characters">Back to characters</TextLink>
      </p>
    </ScaffoldScreen>
  );
}
