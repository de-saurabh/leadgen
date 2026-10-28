import { describe, expect, it } from 'vitest';
import { interactiveKindFor } from './limits.js';

describe('interactiveKindFor', () => {
  it.each([
    [0, null],
    [1, 'buttons'],
    [3, 'buttons'],
    [4, 'list'],
    [10, 'list'],
    [11, null],
  ])('%i options -> %s', (count, expected) => {
    expect(interactiveKindFor(count)).toBe(expected);
  });
});
