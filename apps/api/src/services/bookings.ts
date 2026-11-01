import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';
import type { BookingStatus } from '../db/schema/booking.js';

export class BookingError extends Error {
  constructor(
    public readonly code: 'not_found' | 'invalid_transition',
    message: string,
  ) {
    super(message);
  }
}

/** Who is asking: a member only sees bookings on resources linked to them. */
export interface BookingScope {
  organizationId: string;
  role: string;
  userId: string;
}

/** What a booking can become from each status. */
const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['cancelled', 'no_show', 'completed'],
  cancelled: [],
  rejected: [],
  no_show: [],
  completed: [],
};

export interface BookingFilters {
  status?: BookingStatus | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

function scopeFilter(scope: BookingScope) {
  const base = eq(schema.bookings.organizationId, scope.organizationId);
  return scope.role === 'member'
    ? and(base, eq(schema.resources.memberUserId, scope.userId))
    : base;
}

export async function listBookings(db: AppDb, scope: BookingScope, filters: BookingFilters = {}) {
  const rows = await db
    .select({
      booking: schema.bookings,
      leadName: schema.leads.name,
      leadPhone: schema.leads.phone,
      resourceName: schema.resources.name,
      eventName: schema.events.name,
    })
    .from(schema.bookings)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.bookings.leadId))
    .leftJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
    .leftJoin(schema.events, eq(schema.events.id, schema.bookings.eventId))
    .where(
      and(
        scopeFilter(scope),
        filters.status && eq(schema.bookings.status, filters.status),
        filters.from && gte(schema.bookings.startsAt, filters.from),
        filters.to && lt(schema.bookings.startsAt, filters.to),
      ),
    )
    .orderBy(desc(schema.bookings.startsAt))
    .limit(500);
  return rows.map((r) => ({
    ...r.booking,
    lead: { name: r.leadName, phone: r.leadPhone },
    what: r.resourceName ?? r.eventName ?? '',
  }));
}

/** Moves a booking to a new status if that is allowed from where it is. */
export async function changeBookingStatus(
  db: AppDb,
  scope: BookingScope,
  id: string,
  status: BookingStatus,
) {
  const [found] = await db
    .select({ booking: schema.bookings })
    .from(schema.bookings)
    .leftJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
    .where(and(eq(schema.bookings.id, id), scopeFilter(scope)))
    .limit(1);
  if (!found) throw new BookingError('not_found', 'booking not found');
  const from = found.booking.status;
  if (!TRANSITIONS[from].includes(status)) {
    throw new BookingError('invalid_transition', `A ${from} booking can't become ${status}`);
  }
  // The old status is part of the condition so two people acting at once can't both win.
  const [updated] = await db
    .update(schema.bookings)
    .set({ status })
    .where(and(eq(schema.bookings.id, id), inArray(schema.bookings.status, [from])))
    .returning();
  if (!updated) throw new BookingError('invalid_transition', 'The booking just changed');
  return updated;
}
