import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characters,
  playerAccounts,
  type ActiveAction,
  type Character,
} from "@/db/rune-space";
import { calculateResolutionWindow, type ResolutionWindow } from "@/game/domain/timing";
import { OwnershipError, requireCurrentUser } from "@/server/ownership";

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * This is the intentionally small seam for future activity-specific resolution.
 * It has no registry, scheduler, or production fallback: a caller supplies the
 * action implementation and its atomic persistence work.
 */
export type ActionResolver<Outcome> = {
  resolve(input: { action: ActiveAction; window: ResolutionWindow }): Outcome | Promise<Outcome>;
  persist(transaction: DatabaseTransaction, outcome: Outcome): Promise<void>;
};

export type ResolvedCharacterContext = {
  character: Character;
  action: ActiveAction | undefined;
};

/**
 * Authorize, lock, lazily resolve, and then run one state-changing character
 * command in the same transaction. Locking the character serializes concurrent
 * commands, while the durable action cursor makes retries observe prior work.
 */
export async function withResolvedOwnedCharacter<Outcome, Result>(
  userId: string,
  characterId: string,
  resolver: ActionResolver<Outcome>,
  command: (transaction: DatabaseTransaction, context: ResolvedCharacterContext) => Promise<Result>,
  now: Date = new Date(),
): Promise<Result> {
  return db.transaction(async (transaction) => {
    const accounts = await transaction
      .select({ id: playerAccounts.id })
      .from(playerAccounts)
      .where(eq(playerAccounts.userId, userId))
      .limit(1);
    const account = accounts[0];
    if (!account) throw new OwnershipError("Player account not found", 404);

    // All state-changing character commands use this row lock as their shared
    // concurrency boundary, including future action start/stop commands.
    const characterRows = await transaction
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.playerAccountId, account.id)))
      .for("update");
    const character = characterRows[0];
    if (!character) throw new OwnershipError("Character not found", 404);

    const actionRows = await transaction
      .select()
      .from(activeActions)
      .where(eq(activeActions.characterId, character.id))
      .for("update");
    const action = actionRows[0];

    if (action) {
      const window = calculateResolutionWindow(action.resolvedThroughAt, now);
      if (window.elapsedTicks > 0) {
        const outcome = await resolver.resolve({ action, window });
        await resolver.persist(transaction, outcome);
        await transaction
          .update(activeActions)
          .set({ resolvedThroughAt: window.resolvedThroughAt })
          .where(eq(activeActions.characterId, character.id));
      }
    }

    return command(transaction, { character, action });
  });
}

/** Authenticate a request before entering the shared owned-character command path. */
export async function withResolvedCurrentCharacter<Outcome, Result>(
  headers: Headers,
  characterId: string,
  resolver: ActionResolver<Outcome>,
  command: (transaction: DatabaseTransaction, context: ResolvedCharacterContext) => Promise<Result>,
  now?: Date,
): Promise<Result> {
  const user = await requireCurrentUser(headers);
  return withResolvedOwnedCharacter(user.id, characterId, resolver, command, now);
}
