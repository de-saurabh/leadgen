import { describe, expect, it } from 'vitest';
import { normalizePhone, samePhone } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '919876543210'],
    ['98765 43210', '919876543210'],
    ['09876543210', '919876543210'],
    ['+91 98765-43210', '919876543210'],
    ['919876543210', '919876543210'],
    ['0091 98765 43210', '919876543210'],
    ['(987) 654-3210', '919876543210'],
    ['+1 (415) 555-0132', '14155550132'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalizePhone(input, '91')).toBe(expected);
  });

  it('uses the business country code for local numbers', () => {
    expect(normalizePhone('4155550132', '1')).toBe('14155550132');
  });

  it.each(['', 'abc', '12345', '+0123456789', '1234567890123456', '98765x43210', '+'])(
    'rejects %j',
    (input) => {
      expect(normalizePhone(input, '91')).toBeNull();
    },
  );
});

describe('samePhone', () => {
  it('matches with or without country code', () => {
    expect(samePhone('919876543210', '9876543210')).toBe(true);
    expect(samePhone('919876543210', '919876543211')).toBe(false);
    expect(samePhone('12345', '12345')).toBe(true);
    expect(samePhone('12345', '2345')).toBe(false);
  });
});
