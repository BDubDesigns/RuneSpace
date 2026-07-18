"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensurePlayerAccount, requireCurrentUser, OwnershipError } from "@/server/ownership";
import { createCharacter, CharacterError } from "@/server/characters";

/**
 * Player-facing server action for character creation (thin composition over
 * RuneSpace ownership). The browser is never the source of truth: the action
 * re-authenticates via Better Auth (using the session cookie set natively by
 * the `/api/auth/*` route) and resolves ownership server-side.
 *
 * Authentication itself is handled by the Better Auth client
 * (`features/auth/auth-client.ts`) talking to `/api/auth/*`, which sets the
 * session cookie on the HTTP response directly — so no manual cookie bridging
 * is needed here, and the token is never re-encoded.
 */
export type ActionResult = { error?: string };

export async function createCharacterAction(formData: FormData): Promise<ActionResult> {
  const displayName = String(formData.get("name") ?? "");
  try {
    const user = await requireCurrentUser(await headers());
    const account = await ensurePlayerAccount(user.id);
    const character = await createCharacter(account.id, displayName);
    // `redirect` throws NEXT_REDIRECT; let it propagate out of the action so
    // Next performs the navigation. Only domain errors are caught here.
    redirect(`/play/${character.id}`);
  } catch (err) {
    if (err instanceof CharacterError) return { error: err.message };
    if (err instanceof OwnershipError) return { error: err.message };
    // Re-throw redirect navigation and any unexpected error.
    throw err;
  }
}
