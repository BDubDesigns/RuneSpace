import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characters,
  playerAccounts,
  type ActiveAction,
  type Character,
} from "@/db/rune-space";
import {
  calculateResolutionWindow,
  cursorAfterConsumedTicks,
  type ResolutionWindow,
} from "@/game/domain/timing";
import { OwnershipError, requireCurrentUser } from "@/server/ownership";

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * This is the intentionally small seam for future activity-specific resolution.
 * It has no registry, scheduler, or production fallback: a caller supplies the
 * action implementation and its atomic persistence work.
 */
export type ReadonlySnapshot<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly ReadonlySnapshot<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: ReadonlySnapshot<Value[Key]> }
      : Value;

export type ActionTransition =
  | { kind: "continue"; consumedTicks: number }
  | { kind: "stop"; consumedTicks: number }
  | {
      kind: "replace";
      consumedTicks: number;
      action: Pick<ActiveAction, "actionId" | "startedAt">;
    };

export type ActionResolution<Outcome> = {
  outcome: Outcome;
  transition: ActionTransition;
};

export type ActionResolver<Snapshot, Outcome> = {
  /** An activity-specific caller must never resolve an action it does not own. */
  supports?(action: ActiveAction): boolean;
  load(
    transaction: DatabaseTransaction,
    input: { character: Character; action: ActiveAction },
  ): Snapshot | Promise<Snapshot>;
  resolve(input: {
    action: ActiveAction;
    snapshot: ReadonlySnapshot<Snapshot>;
    window: ResolutionWindow;
  }): ActionResolution<Outcome> | Promise<ActionResolution<Outcome>>;
  persist(transaction: DatabaseTransaction, outcome: Outcome): Promise<void>;
};

function asReadonlySnapshot<Snapshot>(snapshot: Snapshot): ReadonlySnapshot<Snapshot> {
  if (snapshot !== null && typeof snapshot === "object") {
    Object.freeze(snapshot);
    for (const value of Object.values(snapshot)) asReadonlySnapshot(value);
  }
  return snapshot as ReadonlySnapshot<Snapshot>;
}

export type ResolvedCharacterContext = {
  character: Character;
  action: ActiveAction | undefined;
};

/**
 * Authorize, lock, lazily resolve, and then run one state-changing character
 * command in the same transaction. Locking the character serializes concurrent
 * commands, while the durable action cursor makes retries observe prior work.
 */
export async function withResolvedOwnedCharacter<Snapshot, Outcome, Result>(
  userId: string,
  characterId: string,
  resolver: ActionResolver<Snapshot, Outcome>,
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

    if (action && (resolver.supports?.(action) ?? true)) {
      const window = calculateResolutionWindow(action.resolvedThroughAt, now);
      if (window.elapsedTicks > 0) {
        const snapshot = asReadonlySnapshot(
          await resolver.load(transaction, { character, action }),
        );
        const resolution = await resolver.resolve({ action, snapshot, window });
        const resolvedThroughAt = cursorAfterConsumedTicks(
          window,
          resolution.transition.consumedTicks,
        );
        await resolver.persist(transaction, resolution.outcome);

        if (resolution.transition.kind === "continue") {
          await transaction
            .update(activeActions)
            .set({ resolvedThroughAt })
            .where(eq(activeActions.characterId, character.id));
        } else if (resolution.transition.kind === "stop") {
          await transaction
            .delete(activeActions)
            .where(eq(activeActions.characterId, character.id));
        } else {
          await transaction
            .update(activeActions)
            .set({
              actionId: resolution.transition.action.actionId,
              startedAt: resolution.transition.action.startedAt,
              resolvedThroughAt,
            })
            .where(eq(activeActions.characterId, character.id));
        }
      }
    }

    const finalActionRows = await transaction
      .select()
      .from(activeActions)
      .where(eq(activeActions.characterId, character.id))
      .for("update");
    return command(transaction, { character, action: finalActionRows[0] });
  });
}

/** Authenticate a request before entering the shared owned-character command path. */
export async function withResolvedCurrentCharacter<Snapshot, Outcome, Result>(
  headers: Headers,
  characterId: string,
  resolver: ActionResolver<Snapshot, Outcome>,
  command: (transaction: DatabaseTransaction, context: ResolvedCharacterContext) => Promise<Result>,
  now?: Date,
): Promise<Result> {
  const user = await requireCurrentUser(headers);
  return withResolvedOwnedCharacter(user.id, characterId, resolver, command, now);
}
