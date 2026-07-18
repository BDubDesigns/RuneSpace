import Link from "next/link";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { CreateCharacterForm } from "@/features/characters/CreateCharacterForm";

export const metadata = { title: "New character — RuneSpace" };

/** Character creation screen (protected by the server action re-authenticating). */
export default function NewCharacterPage() {
  return (
    <ScaffoldScreen>
      <h1 className="font-mono text-2xl font-bold tracking-tight text-emerald-400">
        New character
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        Choose a name. Names are unique after normalization; you get three slots.
      </p>
      <CreateCharacterForm />
      <p className="mt-6 text-sm text-slate-400">
        <Link href="/characters" className="text-emerald-400 underline">
          Back to characters
        </Link>
      </p>
    </ScaffoldScreen>
  );
}
