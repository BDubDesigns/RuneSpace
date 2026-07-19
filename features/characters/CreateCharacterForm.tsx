"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createCharacterAction } from "@/server/actions";
import { CHARACTER_NAME_MIN, CHARACTER_NAME_MAX } from "@/game/domain/character-name";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { FormField } from "@/components/ui/FormField";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <ActionButton type="submit" loading={pending} className="mt-4 w-full">
      {pending ? "Working…" : label}
    </ActionButton>
  );
}

/**
 * Character creation form (client). Name validation/normalization lives
 * server-side; this form only collects input and surfaces server errors.
 */
export function CreateCharacterForm() {
  const [error, setError] = useState<string | null>(null);

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
      />
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      <SubmitButton label="Create character" />
    </form>
  );
}
