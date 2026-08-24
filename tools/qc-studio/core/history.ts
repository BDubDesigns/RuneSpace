export type SnapshotHistory<T> = {
  past: T[];
  present: T;
  future: T[];
};

export function createSnapshotHistory<T>(initial: T): SnapshotHistory<T> {
  return { past: [], present: initial, future: [] };
}

export function pushSnapshot<T>(history: SnapshotHistory<T>, next: T): SnapshotHistory<T> {
  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
  };
}

export function undoSnapshot<T>(history: SnapshotHistory<T>): SnapshotHistory<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoSnapshot<T>(history: SnapshotHistory<T>): SnapshotHistory<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
