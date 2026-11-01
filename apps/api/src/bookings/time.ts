/** A calendar date with no time zone attached. */
export interface YMD {
  y: number;
  m: number;
  d: number;
}

const partsFormats = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = partsFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormats.set(tz, f);
  }
  return f;
}

/** The wall-clock fields of an instant in a time zone. */
export function localParts(instant: Date, tz: string) {
  const parts = Object.fromEntries(
    formatterFor(tz)
      .formatToParts(instant)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const date = { y: parts.year!, m: parts.month!, d: parts.day! };
  return {
    date,
    minuteOfDay: parts.hour! * 60 + parts.minute!,
    /** ISO weekday: 1 = Monday ... 7 = Sunday. */
    isoWeekday: isoWeekday(date),
  };
}

export function isoWeekday({ y, m, d }: YMD): number {
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDays({ y, m, d }: YMD, days: number): YMD {
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

export function ymdToString({ y, m, d }: YMD): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseYmd(text: string): YMD | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return undefined;
  const ymd = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  return ymdToString(addDays(ymd, 0)) === text ? ymd : undefined;
}

function offsetMs(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.date.y, p.date.m - 1, p.date.d, 0, p.minuteOfDay);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/**
 * The instant at which a time zone's wall clock reads `minuteOfDay` on `date`.
 * Times that don't exist (the skipped hour when clocks go forward) resolve to just after
 * the gap; times that happen twice resolve to the first occurrence.
 */
export function zonedTimeToUtc(date: YMD, minuteOfDay: number, tz: string): Date {
  const naive = Date.UTC(date.y, date.m - 1, date.d, 0, minuteOfDay);
  let utc = naive - offsetMs(new Date(naive), tz);
  const corrected = naive - offsetMs(new Date(utc), tz);
  if (corrected !== utc) utc = corrected;
  return new Date(utc);
}

export function formatDay(instant: Date, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

export function formatTime(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(instant)
    .replace(/\s/g, ' ');
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening';

export const PARTS_OF_DAY: readonly PartOfDay[] = ['morning', 'afternoon', 'evening'];

export function partOfDay(instant: Date, tz: string): PartOfDay {
  const { minuteOfDay } = localParts(instant, tz);
  if (minuteOfDay < 12 * 60) return 'morning';
  if (minuteOfDay < 17 * 60) return 'afternoon';
  return 'evening';
}
