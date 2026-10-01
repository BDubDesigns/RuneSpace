import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activeActions, characters, type ActiveAction, type Character } from "@/db/rune-space";
import {
  calculateResolutionWindow,
  cursorAfterConsumedTicks,
  type ResolutionWindow,
} from "@/game/domain/timing";
import { requireGameplayAccess } from "@/server/gameplay-access";
import { OwnershipError, requireCurrentUser } from "@/server/ownership";
import { assertNotTradeEngaged } from "@/server/player-trade-gate";

export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Best-effort effects a character command queued for after its commit (issue
 * #274), keyed by the command's own transaction. Only the shared command
 * boundaries below register one.
 */
const committedEffects = new WeakMap<DatabaseTransaction, (() => void)[]>();

/**
 * Run `effect` — a realtime prompt, never state — only once the character
 * command that owns `transaction` has committed; a rollback drops it. Only
 * the boundary's own transaction is registered: a transaction opened outside
 * the shared command boundaries (a test or maintenance script), or a nested
 * savepoint inside one, silently has no prompt to give, and its durable state
 * still reaches clients through their ordinary reconciling reads.
 */
export function afterCharacterCommandCommits(
  transaction: DatabaseTransaction,
  effect: () => void,
): void {
  committedEffects.get(transaction)?.push(effect);
}

/** One character-command transaction, then its queued post-commit effects. */
async function characterCommandTransaction<Result>(
  command: (transaction: DatabaseTransaction) => Promise<Result>,
): Promise<Result> {
  const effects: (() => void)[] = [];
  const result = await db.transaction((transaction) => {
    committedEffects.set(transaction, effects);
    return command(transaction);
  });
  for (const effect of effects) {
    try {
      effect();
    } catch {
      // A prompt is best-effort; the committed command has already succeeded.
    }
  }
  return result;
}

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
  persist(
    transaction: DatabaseTransaction,
    outcome: Outcome,
    context?: {
      character: Character;
      action: ActiveAction & { destinationLocationId?: string };
    },
  ): Promise<void>;
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
 * Resolve the owning player account id for a Better Auth user inside a
 * transaction, requiring gameplay access (issue #223).
 *
 * This is the gameplay-access seam for every owned-character command: both
 * `withResolvedOwnedCharacter` and `withLockedOwnedCharacter` enter through it,
 * so a refused account never locks its character row and never reconciles due
 * activity work. The access inputs are read fresh inside this transaction.
 */
async function resolvePlayableAccountId(
  transaction: DatabaseTransaction,
  userId: string,
): Promise<string> {
  return requireGameplayAccess(transaction, userId);
}

/**
 * The single shared character-row lock implementation.
 *
 * - `expectedPlayerAccountId` when supplied (player path): the character is
 *   locked only when it matches BOTH `id` and `player_account_id`, so a forged
 *   or foreign character id matches nothing → no row is locked and the caller
 *   observes the safe `404` without ever revealing or locking another player's
 *   row.
 * - when omitted (admin path): the caller has already satisfied `requireAdmin`;
 *   the character is locked by id alone with no ownership scope.
 *
 * Both player and admin paths share this exact `FOR UPDATE` lock statement.
 */
async function lockCharacterRow(
  transaction: DatabaseTransaction,
  characterId: string,
  expectedPlayerAccountId?: string,
): Promise<Character> {
  const characterRows = await transaction
    .select()
    .from(characters)
    .where(
      expectedPlayerAccountId === undefined
        ? eq(characters.id, characterId)
        : and(
            eq(characters.id, characterId),
            eq(characters.playerAccountId, expectedPlayerAccountId),
          ),
    )
    .for("update");
  const character = characterRows[0];
  if (!character) throw new OwnershipError("Character not found", 404);
  return character;
}

/**
 * Run exactly one lazy reconciliation of the character's active action and
 * return the authoritative post-reconciliation action (undefined when idle).
 *
 * This is the shared reconcile implementation used by both the owned-player
 * path (`withResolvedOwnedCharacter`) and the admin path
 * (`withResolvedCharacter`). It must never be called twice for the same
 * command: a caller invokes it once and then handles the returned action.
 */
async function reconcileActiveAction<Snapshot, Outcome>(
  transaction: DatabaseTransaction,
  character: Character,
  resolver: ActionResolver<Snapshot, Outcome>,
  now: Date,
): Promise<ActiveAction | undefined> {
  const actionRows = await transaction
    .select()
    .from(activeActions)
    .where(eq(activeActions.characterId, character.id))
    .for("update");
  const action = actionRows[0];

  if (action && (resolver.supports?.(action) ?? true)) {
    const window = calculateResolutionWindow(action.resolvedThroughAt, now);
    if (window.elapsedTicks > 0) {
      const snapshot = asReadonlySnapshot(await resolver.load(transaction, { character, action }));
      const resolution = await resolver.resolve({ action, snapshot, window });
      const resolvedThroughAt = cursorAfterConsumedTicks(
        window,
        resolution.transition.consumedTicks,
      );
      // Persist the authoritative outcome (e.g. Mining rewards, or a Travel
      // arrival committing the destination location and clearing travel state)
      // before the transition mutates the action row. For a stop this runs
      // before the action is deleted; for a continue/replace it runs before the
      // cursor is advanced.
      await resolver.persist(transaction, resolution.outcome, { character, action });

      if (resolution.transition.kind === "continue") {
        await transaction
          .update(activeActions)
          .set({ resolvedThroughAt })
          .where(eq(activeActions.characterId, character.id));
      } else if (resolution.transition.kind === "stop") {
        await transaction.delete(activeActions).where(eq(activeActions.characterId, character.id));
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
  return finalActionRows[0];
}

/**
 * How an owned-character command treats a trade-engaged character (issue
 * #266). Every player command is refused while its character holds a pending
 * outgoing trade request or an active trade session, unless it opts out with
 * `allowDuringTrade` — reserved for reads and presentation-only dismissals
 * that cannot change Credits, carried Inventory, or Equipment.
 * `tests/unit/player-trade-gate.test.ts` keeps the opt-out list exact.
 */
export type OwnedCharacterCommandOptions = {
  allowDuringTrade?: boolean;
};

/**
 * The shared owned-character entry: gameplay access, the ownership-scoped row
 * lock, then the trade gate. The gate runs under the row lock, so it is
 * serialized with trade acceptance, which locks both participants' rows.
 */
async function lockPlayableOwnedCharacter(
  transaction: DatabaseTransaction,
  userId: string,
  characterId: string,
  now: Date,
  options: OwnedCharacterCommandOptions,
): Promise<Character> {
  const playerAccountId = await resolvePlayableAccountId(transaction, userId);
  const character = await lockCharacterRow(transaction, characterId, playerAccountId);
  if (!options.allowDuringTrade) await assertNotTradeEngaged(transaction, character.id, now);
  return character;
}

/**
 * Authorize an owned character without resolving its active action.
 * Instantaneous location interactions use this boundary so an expired Mining or
 * Travel row cannot be implicitly progressed as a side effect of the interaction.
 * Gameplay access (issue #223) is required before the row is locked, and a
 * trade-engaged character is refused unless the command opts out (#266).
 */
export async function withLockedOwnedCharacter<Result>(
  userId: string,
  characterId: string,
  command: (transaction: DatabaseTransaction, context: { character: Character }) => Promise<Result>,
  options: OwnedCharacterCommandOptions & { now?: Date } = {},
): Promise<Result> {
  return characterCommandTransaction(async (transaction) => {
    const character = await lockPlayableOwnedCharacter(
      transaction,
      userId,
      characterId,
      options.now ?? new Date(),
      options,
    );
    return command(transaction, { character });
  });
}

/**
 * Authorize, lock, lazily resolve, and then run one state-changing character
 * command in the same transaction. Locking the character serializes concurrent
 * commands, while the durable action cursor makes retries observe prior work.
 *
 * Ownership is verified against the locked character inside the same
 * transaction through the shared `lockCharacterRow` (scoped by the player's
 * account id), so a forged or foreign character id matches nothing and yields
 * the existing safe `404` semantics without locking another player's row.
 * Gameplay access (issue #223) is required first, so a refused account never
 * locks the row or reconciles due activity work. A trade-engaged character is
 * refused before reconciliation unless the command opts out (#266); it is idle
 * by construction, so there is nothing for it to reconcile.
 */
export async function withResolvedOwnedCharacter<Snapshot, Outcome, Result>(
  userId: string,
  characterId: string,
  resolver: ActionResolver<Snapshot, Outcome>,
  command: (transaction: DatabaseTransaction, context: ResolvedCharacterContext) => Promise<Result>,
  now: Date = new Date(),
  options: OwnedCharacterCommandOptions = {},
): Promise<Result> {
  return characterCommandTransaction(async (transaction) => {
    const character = await lockPlayableOwnedCharacter(
      transaction,
      userId,
      characterId,
      now,
      options,
    );
    const action = await reconcileActiveAction(transaction, character, resolver, now);
    return command(transaction, { character, action });
  });
}

/**
 * Lock a character by id WITHOUT an ownership scope. Callers (the admin path)
 * must already have satisfied `requireAdmin` before entering this boundary;
 * it never substitutes for authorization.
 */
export async function withLockedCharacter<Result>(
  characterId: string,
  command: (transaction: DatabaseTransaction, context: { character: Character }) => Promise<Result>,
): Promise<Result> {
  return characterCommandTransaction(async (transaction) => {
    const character = await lockCharacterRow(transaction, characterId);
    return command(transaction, { character });
  });
}

/**
 * Lock a character by id and lazily reconcile its active action exactly once,
 * WITHOUT an ownership scope. Callers (the admin path) must already have
 * satisfied `requireAdmin`; this boundary shares the exact lock + reconcile
 * implementation used by `withResolvedOwnedCharacter`.
 */
export async function withResolvedCharacter<Snapshot, Outcome, Result>(
  characterId: string,
  resolver: ActionResolver<Snapshot, Outcome>,
  command: (transaction: DatabaseTransaction, context: ResolvedCharacterContext) => Promise<Result>,
  now: Date = new Date(),
): Promise<Result> {
  return characterCommandTransaction(async (transaction) => {
    const character = await lockCharacterRow(transaction, characterId);
    const action = await reconcileActiveAction(transaction, character, resolver, now);
    return command(transaction, { character, action });
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
