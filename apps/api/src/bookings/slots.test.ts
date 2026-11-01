import { describe, expect, it } from 'vitest';
import { generateSlots, type SlotRequest } from './slots.js';
import {
  addDays,
  formatDay,
  formatTime,
  isoWeekday,
  localParts,
  parseYmd,
  partOfDay,
  ymdToString,
  zonedTimeToUtc,
} from './time.js';

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';

const request = (over: Partial<SlotRequest> = {}): SlotRequest => ({
  windows: [{ weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60 }], // Mondays 9-11
  slotMinutes: 30,
  timeOff: [],
  timeZone: IST,
  from: { y: 2026, m: 11, d: 2 }, // a Monday
  days: 7,
  notBefore: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('time helpers', () => {
  it('knows the weekday', () => {
    expect(isoWeekday({ y: 2026, m: 11, d: 2 })).toBe(1);
    expect(isoWeekday({ y: 2026, m: 11, d: 8 })).toBe(7);
  });

  it('adds days across month and year ends', () => {
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
    expect(addDays({ y: 2028, m: 2, d: 28 }, 1)).toEqual({ y: 2028, m: 2, d: 29 });
  });

  it('round-trips and rejects impossible dates', () => {
    expect(ymdToString({ y: 2026, m: 3, d: 5 })).toBe('2026-03-05');
    expect(parseYmd('2026-03-05')).toEqual({ y: 2026, m: 3, d: 5 });
    expect(parseYmd('2026-02-30')).toBeUndefined();
    expect(parseYmd('nope')).toBeUndefined();
  });

  it('converts local times to UTC for a fixed-offset zone', () => {
    expect(zonedTimeToUtc({ y: 2026, m: 11, d: 2 }, 9 * 60 + 30, IST).toISOString()).toBe(
      '2026-11-02T04:00:00.000Z',
    );
  });

  it('follows daylight saving time', () => {
    // New York: UTC-5 before 8 March 2026, UTC-4 after.
    expect(zonedTimeToUtc({ y: 2026, m: 3, d: 7 }, 9 * 60, NY).toISOString()).toBe(
      '2026-03-07T14:00:00.000Z',
    );
    expect(zonedTimeToUtc({ y: 2026, m: 3, d: 9 }, 9 * 60, NY).toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });

  it('reads local parts back', () => {
    const p = localParts(new Date('2026-11-02T04:00:00Z'), IST);
    expect(p).toEqual({ date: { y: 2026, m: 11, d: 2 }, minuteOfDay: 570, isoWeekday: 1 });
  });

  it('formats days and times in the business zone', () => {
    const instant = new Date('2026-11-02T04:00:00Z');
    expect(formatDay(instant, IST)).toBe('Mon 2 Nov');
    expect(formatTime(instant, IST)).toBe('9:30 AM');
    expect(formatTime(new Date('2026-11-02T12:00:00Z'), IST)).toBe('5:30 PM');
  });

  it('splits the day into parts', () => {
    const at = (h: number, m = 0) => zonedTimeToUtc({ y: 2026, m: 11, d: 2 }, h * 60 + m, IST);
    expect(partOfDay(at(11, 59), IST)).toBe('morning');
    expect(partOfDay(at(12), IST)).toBe('afternoon');
    expect(partOfDay(at(16, 59), IST)).toBe('afternoon');
    expect(partOfDay(at(17), IST)).toBe('evening');
  });
});

describe('generateSlots', () => {
  it('slices a window into slots on matching weekdays only', () => {
    const slots = generateSlots(request());
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-11-02T03:30:00.000Z',
      '2026-11-02T04:00:00.000Z',
      '2026-11-02T04:30:00.000Z',
      '2026-11-02T05:00:00.000Z',
    ]);
    expect(slots[0]!.endsAt.toISOString()).toBe('2026-11-02T04:00:00.000Z');
  });

  it('covers every matching weekday in the range', () => {
    expect(generateSlots(request({ days: 15 }))).toHaveLength(12); // Mondays: 2, 9, 16 Nov
  });

  it('drops a slot that would run past the end of the window', () => {
    const slots = generateSlots(request({ slotMinutes: 45 }));
    expect(slots).toHaveLength(2); // 9:00 and 9:45; 10:30 would end at 11:15
  });

  it('supports several windows in one day, in order', () => {
    const slots = generateSlots(
      request({
        windows: [
          { weekday: 1, startMinute: 14 * 60, endMinute: 15 * 60 },
          { weekday: 1, startMinute: 9 * 60, endMinute: 10 * 60 },
        ],
      }),
    );
    expect(slots.map((s) => s.startsAt.getTime())).toEqual(
      [...slots.map((s) => s.startsAt.getTime())].sort((a, b) => a - b),
    );
    expect(slots).toHaveLength(4);
  });

  it('leaves out slots that overlap time off', () => {
    const slots = generateSlots(
      request({
        timeOff: [
          { startsAt: new Date('2026-11-02T04:10:00Z'), endsAt: new Date('2026-11-02T04:20:00Z') },
        ],
      }),
    );
    // The 4:00Z slot (9:30 local) overlaps; the others don't.
    expect(slots.map((s) => s.startsAt.toISOString())).not.toContain('2026-11-02T04:00:00.000Z');
    expect(slots).toHaveLength(3);
  });

  it('leaves out slots that start before the notice cut-off', () => {
    const slots = generateSlots(request({ notBefore: new Date('2026-11-02T04:00:00Z') }));
    expect(slots[0]!.startsAt.toISOString()).toBe('2026-11-02T04:00:00.000Z');
    expect(slots).toHaveLength(3);
  });

  it('uses local time across a daylight-saving change', () => {
    const slots = generateSlots(
      request({
        timeZone: NY,
        windows: [
          { weekday: 6, startMinute: 9 * 60, endMinute: 9 * 60 + 30 }, // Saturdays
          { weekday: 1, startMinute: 9 * 60, endMinute: 9 * 60 + 30 }, // Mondays
        ],
        from: { y: 2026, m: 3, d: 7 }, // Saturday before the change
        days: 3,
      }),
    );
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-03-07T14:00:00.000Z', // 9:00 EST
      '2026-03-09T13:00:00.000Z', // 9:00 EDT
    ]);
  });

  it('returns nothing for empty hours or a zero-length slot', () => {
    expect(generateSlots(request({ windows: [] }))).toEqual([]);
    expect(generateSlots(request({ slotMinutes: 0 }))).toEqual([]);
  });
});
