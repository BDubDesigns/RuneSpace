"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createCharacterAction } from "@/server/actions";
import { CHARACTER_NAME_MIN, CHARACTER_NAME_MAX } from "@/game/domain/character-name";
import type { SelectablePortraitOption } from "@/game/domain/character-portrait";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { FormField } from "@/components/ui/FormField";
import { PortraitPicker } from "@/components/portraits/PortraitPicker";

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending} disabled={disabled} className="w-full">
      {pending ? "Working…" : label}
    </ActionButton>
  );
}

/**
 * Character creation form (client, issue #65). Name validation/normalization
 * and portrait selectability live server-side; this form collects the
 * deliberate portrait choice through the shared chooser and surfaces server
 * errors. The final Create action cannot succeed until both the name and one
 * portrait selection are valid — the browser never decides which portraits
 * exist or are selectable. There is no separate Save portrait step: Create
 * Character is the confirmation and persists the portrait atomically with the
 * new character.
 */
export function CreateCharacterForm({
  options,
}: {
  /** Server-projected selectable portrait options (the ten player-starter entries). */
  options: readonly SelectablePortraitOption[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [portraitId, setPortraitId] = useState<string | null>(null);

  const nameValid = name.trim().length >= CHARACTER_NAME_MIN;
  const canCreate = nameValid && portraitId !== null;

  return (
    <form
      action={async (formData: FormData) => {
        setError(null);
        const result = await createCharacterAction(formData);
        if (result?.error) setError(result.error);
      }}
      className="mt-6 space-y-3"
    >
      <FormField
        id="character-name"
        name="name"
        type="text"
        required
        minLength={CHARACTER_NAME_MIN}
        maxLength={CHARACTER_NAME_MAX}
        placeholder="e.g. Star Drifter"
        label="Character name"
        onChange={(event) => setName(event.target.value)}
      />
      {/* The deliberate portrait choice is submitted as part of the
          authoritative creation command; the server re-validates it. */}
      <input name="portraitId" type="hidden" value={portraitId ?? ""} />
      <div>
        <p className="text-sm font-medium text-[color:var(--rs-text-secondary)]">
          Choose a portrait
        </p>
        <p className="mt-1 text-xs text-[color:var(--rs-text-muted)]">
          This portrait represents your character wherever they appear.
        </p>
        <div className="mt-3">
          <PortraitPicker
            action={<SubmitButton label="Create character" disabled={!canCreate} />}
            label="Character portrait"
            onSelect={setPortraitId}
            options={options}
            selectedPortraitId={portraitId}
          />
        </div>
      </div>
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
    </form>
  );
}
