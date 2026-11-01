import { describe, expect, it } from 'vitest';
import {
  defaultHours,
  formatWhen,
  hoursProblem,
  isoToLocalInput,
  localInputToIso,
  minutesToTime,
  summarizeHours,
  timeToMinutes,
} from './helpers';

describe('time of day', () => {
  it('converts between minutes and input values', () => {
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(1440)).toBe('24:00');
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(timeToMinutes('25:00')).toBeUndefined();
    expect(timeToMinutes('9:75')).toBeUndefined();
    expect(timeToMinutes('')).toBeUndefined();
  });
});

describe('hoursProblem', () => {
  it('accepts normal hours and split shifts', () => {
    expect(hoursProblem(defaultHours())).toBeUndefined();
    expect(
      hoursProblem([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 780, endMinute: 1020 },
      ]),
    ).toBeUndefined();
  });

  it('rejects empty and overlapping windows', () => {
    expect(hoursProblem([{ weekday: 1, startMinute: 600, endMinute: 600 }])).toMatch(/end after/);
    expect(
      hoursProblem([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 700, endMinute: 800 },
      ]),
    ).toMatch(/overlap/);
  });
});

describe('summarizeHours', () => {
  it('groups days that share times', () => {
    expect(summarizeHours(defaultHours())).toBe('Mon-Fri 09:00-17:00');
    expect(
      summarizeHours([...defaultHours(), { weekday: 6, startMinute: 600, endMinute: 780 }]),
    ).toBe('Mon-Fri 09:00-17:00, Sat 10:00-13:00');
    expect(summarizeHours([])).toBe('No opening hours');
  });
});

describe('business-zone date inputs', () => {
  it('round-trips in a fixed-offset zone', () => {
    const iso = localInputToIso('2026-12-20T22:00', 'Asia/Kolkata');
    expect(iso).toBe('2026-12-20T16:30:00.000Z');
    expect(isoToLocalInput(iso!, 'Asia/Kolkata')).toBe('2026-12-20T22:00');
  });

  it('follows daylight saving', () => {
    expect(localInputToIso('2026-03-07T09:00', 'America/New_York')).toBe(
      '2026-03-07T14:00:00.000Z',
    );
    expect(localInputToIso('2026-03-09T09:00', 'America/New_York')).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });

  it('rejects text that is not a datetime-local value', () => {
    expect(localInputToIso('', 'Asia/Kolkata')).toBeUndefined();
  });

  it('formats a moment for people', () => {
    expect(formatWhen('2026-11-02T04:00:00Z', 'Asia/Kolkata')).toBe('Mon 2 Nov, 9:30 AM');
  });
});
