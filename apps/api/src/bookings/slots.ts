import { addDays, isoWeekday, zonedTimeToUtc, type YMD } from './time.js';

export interface HoursWindow {
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  weekday: number;
  /** Minutes after local midnight. */
  startMinute: number;
  endMinute: number;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

export interface SlotRequest {
  windows: readonly HoursWindow[];
  slotMinutes: number;
  timeOff: ReadonlyArray<{ startsAt: Date; endsAt: Date }>;
  timeZone: string;
  /** First local date to generate for. */
  from: YMD;
  /** How many local days to cover, starting at `from`. */
  days: number;
  /** Slots starting before this instant are left out (it is "now" plus a notice period). */
  notBefore: Date;
}

/**
 * Cuts a resource's weekly hours into bookable slots, in business-local time, minus
 * time off and anything too soon. Slots that don't fit before a window closes are dropped.
 */
export function generateSlots(request: SlotRequest): Slot[] {
  const { windows, slotMinutes, timeOff, timeZone, notBefore } = request;
  if (slotMinutes <= 0) return [];
  const slots: Slot[] = [];

  for (let offset = 0; offset < request.days; offset++) {
    const date = addDays(request.from, offset);
    const weekday = isoWeekday(date);
    for (const window of windows.filter((w) => w.weekday === weekday)) {
      for (
        let start = window.startMinute;
        start + slotMinutes <= window.endMinute;
        start += slotMinutes
      ) {
        const startsAt = zonedTimeToUtc(date, start, timeZone);
        const endsAt = new Date(startsAt.getTime() + slotMinutes * 60_000);
        if (startsAt < notBefore) continue;
        if (timeOff.some((off) => startsAt < off.endsAt && endsAt > off.startsAt)) continue;
        slots.push({ startsAt, endsAt });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
