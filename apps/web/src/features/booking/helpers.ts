export const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
] as const;

export interface HoursRow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** 570 -> "09:30", the value of an `<input type="time">`. */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "09:30" -> 570; "24:00" is allowed as the end of the day. */
export function timeToMinutes(time: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return undefined;
  const total = Number(match[1]) * 60 + Number(match[2]);
  return total <= 24 * 60 && Number(match[2]) < 60 ? total : undefined;
}

/** Mon-Fri 9 to 5: what a new resource starts with. */
export function defaultHours(): HoursRow[] {
  return [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 17 * 60 }));
}

/** Describes why a set of hours can't be saved, or undefined when they're fine. */
export function hoursProblem(rows: readonly HoursRow[]): string | undefined {
  for (const r of rows) {
    if (r.startMinute >= r.endMinute) return 'Each opening time must end after it starts.';
  }
  for (const day of new Set(rows.map((r) => r.weekday))) {
    const sorted = rows
      .filter((r) => r.weekday === day)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.startMinute < sorted[i - 1]!.endMinute) {
        return 'Opening times on the same day overlap.';
      }
    }
  }
  return undefined;
}

/** "Mon-Fri 09:00-17:00" style summary, one line per distinct set of times. */
export function summarizeHours(rows: readonly HoursRow[]): string {
  if (rows.length === 0) return 'No opening hours';
  const names = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const byTimes = new Map<string, number[]>();
  for (const r of [...rows].sort(
    (a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute,
  )) {
    byTimes.set(`${minutesToTime(r.startMinute)}-${minutesToTime(r.endMinute)}`, [
      ...(byTimes.get(`${minutesToTime(r.startMinute)}-${minutesToTime(r.endMinute)}`) ?? []),
      r.weekday,
    ]);
  }
  return [...byTimes.entries()]
    .map(([times, days]) => `${dayRanges(days, names)} ${times}`)
    .join(', ');
}

function dayRanges(days: number[], names: string[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(
      j - i >= 2
        ? `${names[sorted[i]!]}-${names[sorted[j]!]}`
        : sorted
            .slice(i, j + 1)
            .map((d) => names[d])
            .join(', '),
    );
    i = j + 1;
  }
  return parts.join(', ');
}

function partsIn(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    mi: Number(parts.minute),
  };
}

/** An instant as the value of an `<input type="datetime-local">` in the business's zone. */
export function isoToLocalInput(iso: string, timeZone: string): string {
  const p = partsIn(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** The reverse: what the owner typed, read as a time in the business's zone. */
export function localInputToIso(local: string, timeZone: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return undefined;
  const [y, mo, d, h, mi] = match.slice(1).map(Number) as [number, number, number, number, number];
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  // Start from the wall time as if it were UTC, then correct by the zone's offset there.
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), timeZone);
    guess += wanted - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return new Date(guess).toISOString();
}

/** "Mon 2 Nov, 9:30 AM" in the business's zone. */
export function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${day.replace(',', '')}, ${time.replace(/\s/g, ' ')}`;
}
