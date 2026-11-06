import { useState } from 'react';

export interface FreshState {
  scope: string;
  seen: Set<string> | null;
  fresh: Set<string>;
}

export const initialFresh = (scope: string): FreshState => ({
  scope,
  seen: null,
  fresh: new Set(),
});

/** The next state for a list of ids; returns the same object when nothing changed. */
export function advanceFresh(state: FreshState, ids: string[], scope: string): FreshState {
  if (state.scope !== scope) return advanceFresh(initialFresh(scope), ids, scope);
  if (ids.length === 0) return state;
  if (state.seen === null) return { scope, seen: new Set(ids), fresh: new Set() };
  const seen = state.seen;
  const arrived = ids.filter((id) => !seen.has(id));
  if (arrived.length === 0) return state;
  return {
    scope,
    seen: new Set([...seen, ...arrived]),
    fresh: new Set([...state.fresh, ...arrived]),
  };
}

/**
 * Tells which ids showed up after the list was first on screen, so live arrivals can be
 * highlighted while the initial load stays calm. Changing `scope` (a filter, a different
 * lead) starts over without flashing everything.
 */
export function useFreshIds(ids: string[], scope: string): Set<string> {
  const [state, setState] = useState(() => initialFresh(scope));
  const next = advanceFresh(state, ids, scope);
  if (next !== state) setState(next);
  return next.fresh;
}
