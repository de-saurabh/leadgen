import { describe, expect, it } from 'vitest';
import { advanceFresh, initialFresh } from './fresh';

describe('advanceFresh', () => {
  it('does not flag the first load, then flags later arrivals', () => {
    let s = initialFresh('a');
    s = advanceFresh(s, [], 'a');
    s = advanceFresh(s, ['1', '2'], 'a');
    expect([...s.fresh]).toEqual([]);
    s = advanceFresh(s, ['1', '2', '3'], 'a');
    expect([...s.fresh]).toEqual(['3']);
  });

  it('returns the same state when nothing changed', () => {
    const s = advanceFresh(initialFresh('a'), ['1'], 'a');
    expect(advanceFresh(s, ['1'], 'a')).toBe(s);
  });

  it('starts over when the scope changes', () => {
    let s = advanceFresh(initialFresh('a'), ['1'], 'a');
    s = advanceFresh(s, ['1', '2'], 'a');
    expect([...s.fresh]).toEqual(['2']);
    s = advanceFresh(s, ['9'], 'b');
    expect([...s.fresh]).toEqual([]);
  });
});
