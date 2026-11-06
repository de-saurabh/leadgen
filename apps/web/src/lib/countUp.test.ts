import { describe, expect, it } from 'vitest';
import { countAt, easeOut } from './countUp';

describe('count up maths', () => {
  it('starts at the beginning and ends exactly on the target', () => {
    expect(countAt(0, 90, 0)).toBe(0);
    expect(countAt(0, 90, 1)).toBe(90);
    expect(countAt(40, 10, 1)).toBe(10);
  });

  it('eases out: past halfway after half the time, and never overshoots', () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(easeOut(2)).toBe(1);
    expect(easeOut(-1)).toBe(0);
  });
});
