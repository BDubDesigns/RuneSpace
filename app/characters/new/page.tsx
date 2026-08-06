import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TextLink } from "@/components/ui/TextLink";
import { CreateCharacterForm } from "@/features/characters/CreateCharacterForm";
import { getSelectablePortraitOptions } from "@/game/domain/character-portrait";

export const metadata = { title: "New character — RuneSpace" };

export default function NewCharacterPage() {
  // Server-projected selectable portrait options: exactly the ten
  // player-starter catalog entries (issue #65).
  const portraitOptions = getSelectablePortraitOptions();

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
