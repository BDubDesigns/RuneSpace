"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createCharacterAction } from "@/server/actions";
import { CHARACTER_NAME_MIN, CHARACTER_NAME_MAX } from "@/game/domain/character-name";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
    >
      {pending ? "Working…" : label}
    </button>
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
      <label className="block">
        <span className="text-sm text-slate-300">Character name</span>
        <input
          name="name"
          type="text"
          required
          minLength={CHARACTER_NAME_MIN}
          maxLength={CHARACTER_NAME_MAX}
          placeholder="e.g. Star Drifter"
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
        />
      </label>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <SubmitButton label="Create character" />
    </form>
  );
}
