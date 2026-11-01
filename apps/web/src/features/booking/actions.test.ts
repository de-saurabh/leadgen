import { describe, expect, it } from 'vitest';
import { actionsFor } from './actions';
import { toggled } from './selection';

describe('actionsFor', () => {
  it('lets a pending booking be approved or declined', () => {
    expect(actionsFor('pending').map((a) => a.status)).toEqual(['confirmed', 'rejected']);
    expect(actionsFor('pending')[0]!.primary).toBe(true);
  });

  it('offers follow-ups for a confirmed booking and nothing once it is closed', () => {
    expect(actionsFor('confirmed').map((a) => a.status)).toEqual([
      'completed',
      'no_show',
      'cancelled',
    ]);
    for (const status of ['cancelled', 'rejected', 'no_show', 'completed'] as const) {
      expect(actionsFor(status)).toEqual([]);
    }
  });
});

describe('toggled', () => {
  it('adds without duplicating and removes', () => {
    expect(toggled(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a', false)).toEqual(['b']);
  });
});
