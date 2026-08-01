/** Pure command gate model used by the shared play-scope coordinator. */
export type GateModel = {
  locked: boolean;
  pending: boolean;
  pendingToken?: number;
};

export function tryAcquire(model: GateModel): boolean {
  if (model.locked) return false;
  model.locked = true;
  return true;
}

/**
 * Releases the gate and returns true when a coalesced refresh should run.
 * The caller is responsible for executing the refresh and passing an
 * up-to-date status-only reconciliation — never a mutation.
 */
export function release(model: GateModel): boolean {
  model.locked = false;
  if (model.pending) {
    model.pending = false;
    model.pendingToken = undefined;
    return true;
  }
  return false;
}

/**
 * Registers an automatic refresh request.
 *
 * Returns true when the refresh should run immediately. Returns false
 * when a command is in flight; the gate will schedule exactly one
 * refresh after that command settles.
 */
export function requestRefresh(model: GateModel, token?: number): boolean {
  if (model.locked) {
    model.pending = true;
    model.pendingToken = token;
    return false;
  }
  return true;
}

/** Cancel only a coalesced refresh belonging to the supplied scheduler cycle. */
export function cancelRefresh(model: GateModel, token: number): void {
  if (model.pending && model.pendingToken === token) {
    model.pending = false;
    model.pendingToken = undefined;
  }
}
