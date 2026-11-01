import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import { generateSlots } from '../bookings/slots.js';
import { localParts } from '../bookings/time.js';
import * as schema from '../db/schema/index.js';
import { CAPACITY_STATUSES } from '../db/schema/booking.js';

/** How far ahead customers can book, and how much notice a business needs. */
export const BOOKING_HORIZON_DAYS = 14;
export const MIN_NOTICE_MINUTES = 60;

export type BookingExec = Pick<AppDb, 'select' | 'insert' | 'execute'>;

export interface ResourceOffer {
  id: string;
  name: string;
}

export interface SlotOffer {
  resourceId: string;
  resourceName: string;
  startsAt: Date;
  endsAt: Date;
}

export interface EventOffer {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  remaining: number;
}

export interface Booked {
  id: string;
  name: string;
  startsAt: Date;
  status: 'pending' | 'confirmed';
}

/** What the conversation engine needs from the booking system. */
export interface BookingPort {
  timeZone: string;
  resources(): Promise<ResourceOffer[]>;
  /** Free slots in the booking horizon. `resourceId` null means any of the campaign's resources. */
  slots(resourceId: string | null, partySize: number): Promise<SlotOffer[]>;
  events(partySize: number): Promise<EventOffer[]>;
  /** Undefined when the slot was taken in the meantime. */
  bookSlot(input: {
    resourceId: string | null;
    startsAt: Date;
    partySize: number;
  }): Promise<Booked | undefined>;
  bookEvent(input: { eventId: string; partySize: number }): Promise<Booked | undefined>;
}

export interface BookingPortContext {
  organizationId: string;
  campaignId: string;
  leadId: string;
  timeZone: string;
  countPartySize: boolean;
  requiresApproval: boolean;
  now?: () => Date;
}

type BookingRow = Pick<
  typeof schema.bookings.$inferSelect,
  'resourceId' | 'eventId' | 'startsAt' | 'endsAt' | 'partySize'
>;

export function createBookingPort(exec: BookingExec, ctx: BookingPortContext): BookingPort {
  const now = ctx.now ?? (() => new Date());
  const unitsOf = (partySize: number) => (ctx.countPartySize ? Math.max(1, partySize) : 1);
  const heldBy = (b: Pick<BookingRow, 'partySize'>) => (ctx.countPartySize ? b.partySize : 1);

  async function campaignResources() {
    return exec
      .select({ resource: schema.resources })
      .from(schema.campaignResources)
      .innerJoin(schema.resources, eq(schema.resources.id, schema.campaignResources.resourceId))
      .where(
        and(
          eq(schema.campaignResources.campaignId, ctx.campaignId),
          eq(schema.resources.organizationId, ctx.organizationId),
          eq(schema.resources.active, true),
        ),
      )
      .orderBy(asc(schema.resources.name), asc(schema.resources.id))
      .then((rows) => rows.map((r) => r.resource));
  }

  async function holdingBookings(where: ReturnType<typeof and>): Promise<BookingRow[]> {
    return exec
      .select({
        resourceId: schema.bookings.resourceId,
        eventId: schema.bookings.eventId,
        startsAt: schema.bookings.startsAt,
        endsAt: schema.bookings.endsAt,
        partySize: schema.bookings.partySize,
      })
      .from(schema.bookings)
      .where(and(inArray(schema.bookings.status, [...CAPACITY_STATUSES]), where));
  }

  async function slotsFor(
    resources: Array<typeof schema.resources.$inferSelect>,
    partySize: number,
  ): Promise<SlotOffer[]> {
    if (resources.length === 0) return [];
    const ids = resources.map((r) => r.id);
    const t = now();
    const today = localParts(t, ctx.timeZone).date;
    const horizonEnd = new Date(t.getTime() + (BOOKING_HORIZON_DAYS + 1) * 86_400_000);

    const [hours, timeOff, booked] = await Promise.all([
      exec.select().from(schema.resourceHours).where(inArray(schema.resourceHours.resourceId, ids)),
      exec
        .select()
        .from(schema.resourceTimeOff)
        .where(
          and(
            inArray(schema.resourceTimeOff.resourceId, ids),
            gt(schema.resourceTimeOff.endsAt, t),
          ),
        ),
      holdingBookings(
        and(
          inArray(schema.bookings.resourceId, ids),
          gt(schema.bookings.endsAt, t),
          lt(schema.bookings.startsAt, horizonEnd),
        ),
      ),
    ]);

    const units = unitsOf(partySize);
    const offers: SlotOffer[] = [];
    for (const resource of resources) {
      if (units > resource.capacity) continue;
      const slots = generateSlots({
        windows: hours.filter((h) => h.resourceId === resource.id),
        slotMinutes: resource.slotMinutes,
        timeOff: timeOff.filter((o) => o.resourceId === resource.id),
        timeZone: ctx.timeZone,
        from: today,
        days: BOOKING_HORIZON_DAYS,
        notBefore: new Date(t.getTime() + MIN_NOTICE_MINUTES * 60_000),
      });
      const mine = booked.filter((b) => b.resourceId === resource.id);
      for (const slot of slots) {
        const used = mine
          .filter((b) => b.startsAt < slot.endsAt && b.endsAt > slot.startsAt)
          .reduce((sum, b) => sum + heldBy(b), 0);
        if (used + units <= resource.capacity) {
          offers.push({ ...slot, resourceId: resource.id, resourceName: resource.name });
        }
      }
    }
    return offers.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  /** Serializes everyone competing for the same thing until the transaction ends. */
  async function lock(key: string) {
    await exec.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  function insertBooking(values: {
    resourceId?: string;
    eventId?: string;
    startsAt: Date;
    endsAt: Date;
    partySize: number;
  }) {
    const status = ctx.requiresApproval ? ('pending' as const) : ('confirmed' as const);
    return exec
      .insert(schema.bookings)
      .values({
        organizationId: ctx.organizationId,
        leadId: ctx.leadId,
        ...values,
        status,
      })
      .returning({ id: schema.bookings.id })
      .then(([row]) => ({ id: row!.id, status }));
  }

  return {
    timeZone: ctx.timeZone,

    async resources() {
      return (await campaignResources()).map((r) => ({ id: r.id, name: r.name }));
    },

    async slots(resourceId, partySize) {
      const all = await campaignResources();
      return slotsFor(resourceId ? all.filter((r) => r.id === resourceId) : all, partySize);
    },

    async events(partySize) {
      const t = now();
      const rows = await exec
        .select({ event: schema.events })
        .from(schema.campaignEvents)
        .innerJoin(schema.events, eq(schema.events.id, schema.campaignEvents.eventId))
        .where(
          and(
            eq(schema.campaignEvents.campaignId, ctx.campaignId),
            eq(schema.events.organizationId, ctx.organizationId),
            eq(schema.events.active, true),
            gt(schema.events.startsAt, t),
          ),
        )
        .orderBy(asc(schema.events.startsAt));
      if (rows.length === 0) return [];
      const booked = await holdingBookings(
        inArray(
          schema.bookings.eventId,
          rows.map((r) => r.event.id),
        ),
      );
      const units = unitsOf(partySize);
      return rows
        .map(({ event }) => {
          const used = booked
            .filter((b) => b.eventId === event.id)
            .reduce((sum, b) => sum + heldBy(b), 0);
          return {
            id: event.id,
            name: event.name,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            remaining: event.capacity - used,
          };
        })
        .filter((e) => e.remaining >= units);
    },

    async bookSlot({ resourceId, startsAt, partySize }) {
      const all = await campaignResources();
      const candidates = resourceId ? all.filter((r) => r.id === resourceId) : all;
      for (const resource of candidates) {
        await lock(`resource:${resource.id}:${startsAt.toISOString()}`);
        // Re-checked under the lock; the offer shown to the customer may be stale.
        const free = (await slotsFor([resource], partySize)).find(
          (s) => s.startsAt.getTime() === startsAt.getTime(),
        );
        if (!free) continue;
        const { id, status } = await insertBooking({
          resourceId: resource.id,
          startsAt: free.startsAt,
          endsAt: free.endsAt,
          partySize,
        });
        return { id, name: resource.name, startsAt: free.startsAt, status };
      }
      return undefined;
    },

    async bookEvent({ eventId, partySize }) {
      await lock(`event:${eventId}`);
      const event = (await this.events(partySize)).find((e) => e.id === eventId);
      if (!event) return undefined;
      const { id, status } = await insertBooking({
        eventId,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        partySize,
      });
      return { id, name: event.name, startsAt: event.startsAt, status };
    },
  };
}
