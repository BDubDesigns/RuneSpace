"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { FormField } from "@/components/ui/FormField";
import { Panel } from "@/components/ui/Panel";
import { adminSearchCharacters, type AdminSearchResult } from "@/server/admin-actions";

type Result = Extract<AdminSearchResult, { results?: unknown }>;

/**
 * Operator character search (Issue #113). Submits the query and renders results
 * as links into the per-character inspector. Every result is a server-derived
 * character with narrow owner identity; the search itself only lists, it never
 * mutates state.
 */
export function AdminSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<Result["results"]>([]);
  const [error, setError] = useState<string | null>(null);

  function runSearch(next?: string) {
    const q = (next ?? query).trim();
    startTransition(async () => {
      const response: AdminSearchResult = await adminSearchCharacters({ query: q });
      if ("error" in response) {
        setError(response.error);
        setResults([]);
        return;
      }
      setError(null);
      setResults(response.results);
    });
  }

  return (
    <Panel className="p-4" tone="raised">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <FormField
          label="Character name"
          id="admin-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a character name to search"
          autoComplete="off"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <ActionButton type="submit" loading={pending}>
            Search
          </ActionButton>
        </div>
      </form>

      {error ? <Feedback tone="danger">{error}</Feedback> : null}

      {results.length > 0 ? (
        <ul className="mt-5 space-y-2" aria-label="Search results">
          {results.map((character) => (
            <li key={character.id}>
              <button
                type="button"
                className="rs-focus w-full border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface)] px-3 py-2 text-left text-sm transition hover:border-[color:var(--rs-accent)]"
                onClick={() => router.push(`/admin/characters/${character.id}`)}
              >
                <span className="font-medium text-[color:var(--rs-text-primary)]">
                  {character.displayName}
                </span>
                <span className="ml-2 text-xs text-[color:var(--rs-text-muted)]">
                  {character.owner.playerAccountId.slice(0, 8)}
                  {character.owner.maskedEmail ? ` · ${character.owner.maskedEmail}` : ""}
                  {character.currentLocationId ? ` · ${character.currentLocationId}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-[color:var(--rs-text-muted)]">
          No results yet. Search by character name.
        </p>
      )}
    </Panel>
  );
}
