import { describe, expect, it } from 'vitest';
import { answerText, describeMessage, percent, timeAgo, windowIsOpen } from './helpers';

describe('describeMessage', () => {
  it('shows text and the choices offered', () => {
    expect(describeMessage('text', { body: 'Hello' })).toBe('Hello');
    expect(
      describeMessage('buttons', {
        body: 'Budget?',
        options: [{ title: 'Low' }, { title: 'High' }],
      }),
    ).toBe('Budget?\n[Low | High]');
    expect(describeMessage('template', { name: 'hello_world' })).toBe(
      'Template message (hello_world)',
    );
  });

  it('shows what a customer tapped or sent', () => {
    expect(describeMessage('reply', { title: 'High', id: 'budget:high' })).toBe('High');
    expect(describeMessage('reply', { id: 'budget:high' })).toBe('budget:high');
    expect(describeMessage('other', { type: 'image' })).toBe('[other message]');
  });
});

describe('windowIsOpen', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  it('is open for 24 hours after the customer last wrote', () => {
    expect(windowIsOpen('2026-11-02T00:00:00Z', now)).toBe(true);
    expect(windowIsOpen('2026-11-01T11:59:00Z', now)).toBe(false);
    expect(windowIsOpen(null, now)).toBe(false);
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  it('reads naturally', () => {
    expect(timeAgo('2026-11-02T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2026-11-02T11:30:00Z', now)).toBe('30 min ago');
    expect(timeAgo('2026-11-02T06:00:00Z', now)).toBe('6 h ago');
    expect(timeAgo('2026-10-30T12:00:00Z', now)).toBe('3 d ago');
    expect(timeAgo(null, now)).toBe('never');
  });
});

describe('answerText', () => {
  it('formats lists and booleans', () => {
    expect(answerText(['a', 'b'])).toBe('a, b');
    expect(answerText(true)).toBe('Yes');
    expect(answerText(4)).toBe('4');
  });
});

describe('percent', () => {
  it('rounds and handles an empty whole', () => {
    expect(percent(1, 3)).toBe('33%');
    expect(percent(0, 0)).toBe('-');
  });
});
