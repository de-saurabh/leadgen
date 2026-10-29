function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Reads a calendar date typed as `2026-12-31` or `31/12/2026` (also `-` or `.` as separators)
 * and returns it as `YYYY-MM-DD`, or `undefined` when it isn't a real date.
 */
export function parseDate(text: string): string | undefined {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : dmy
      ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])]
      : undefined;
  if (!parts) return undefined;
  const [year, month, day] = parts as [number, number, number];
  if (!isRealDate(year, month, day)) return undefined;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
