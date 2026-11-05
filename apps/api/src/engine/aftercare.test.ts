import { describe, expect, it } from 'vitest';
import { cancelConfirmation, changeButtons, intentOf } from './aftercare.js';

const text = (body: string) => ({ kind: 'text' as const, body });
const tap = (id: string) => ({ kind: 'reply' as const, id, title: '' });

describe('intentOf', () => {
  it('reads the booking buttons', () => {
    expect(intentOf(tap('_booking:cancel'))).toBe('cancel');
    expect(intentOf(tap('_booking:cancel_yes'))).toBe('cancel_yes');
    expect(intentOf(tap('_booking:keep'))).toBe('keep');
    expect(intentOf(tap('_booking:reschedule'))).toBe('reschedule');
    expect(intentOf(tap('_booking:nonsense'))).toBe('other');
    expect(intentOf(tap('budget:low'))).toBe('other');
  });

  it('reads typed requests', () => {
    expect(intentOf(text('Please cancel my booking'))).toBe('cancel');
    expect(intentOf(text('can I reschedule?'))).toBe('reschedule');
    expect(intentOf(text('I want to change my time'))).toBe('reschedule');
    expect(intentOf(text('need a different day'))).toBe('reschedule');
    expect(intentOf(text('thanks!'))).toBe('other');
    expect(intentOf({ kind: 'other', type: 'image' })).toBe('other');
  });
});

describe('buttons', () => {
  it('fit WhatsApp limits', () => {
    for (const m of [changeButtons('x'), cancelConfirmation('x')]) {
      expect(m.kind).toBe('buttons');
      if (m.kind === 'buttons') {
        expect(m.options.length).toBeLessThanOrEqual(3);
        for (const o of m.options) expect(o.title.length).toBeLessThanOrEqual(20);
      }
    }
  });
});
