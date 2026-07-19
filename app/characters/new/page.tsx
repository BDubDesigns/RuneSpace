import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TextLink } from "@/components/ui/TextLink";
import { CreateCharacterForm } from "@/features/characters/CreateCharacterForm";

export const metadata = { title: "New character — RuneSpace" };

export default function NewCharacterPage() {
  return (
    <ScaffoldScreen>
      <SectionHeader eyebrow="Character selection">New character</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Choose a name. Names are unique after normalization; you get three slots.
      </p>
      <CreateCharacterForm />
      <p className="mt-6 text-sm text-[color:var(--rs-text-secondary)]">
        <TextLink href="/characters">Back to characters</TextLink>
      </p>
    </ScaffoldScreen>
  );
}
