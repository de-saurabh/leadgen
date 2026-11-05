import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';
import { CAPACITY_STATUSES } from '../db/schema/booking.js';

/** A conversation that has been quiet this long is over (it is also WhatsApp's free-form window). */
export const STALE_AFTER_HOURS = 24;

/**
 * Marks quiet, unfinished leads as dropped and frees any booking they were holding.
 * A booking the customer is in the middle of rescheduling stays, since it is still theirs.
 * Returns how many leads were dropped.
 */
export async function dropStaleLeads(db: AppDb, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_HOURS * 3_600_000);
  const stale = await db
    .select({
      id: schema.leads.id,
      campaignId: schema.leads.campaignId,
      flowState: schema.leads.flowState,
    })
    .from(schema.leads)
    .where(
      and(
        inArray(schema.leads.status, ['new', 'in_conversation']),
        lt(sql`coalesce(${schema.leads.lastInboundAt}, ${schema.leads.createdAt})`, cutoff),
      ),
    );

  let dropped = 0;
  for (const lead of stale) {
    const keep = lead.flowState.reschedulingBookingId;
    const did = await db.transaction(async (tx) => {
      // The status condition makes this safe against a customer replying at the same moment.
      const [row] = await tx
        .update(schema.leads)
        .set({ status: 'dropped', currentQuestionId: null })
        .where(
          and(
            eq(schema.leads.id, lead.id),
            inArray(schema.leads.status, ['new', 'in_conversation']),
            lt(sql`coalesce(${schema.leads.lastInboundAt}, ${schema.leads.createdAt})`, cutoff),
          ),
        )
        .returning({ id: schema.leads.id });
      if (!row) return false;
      await tx
        .insert(schema.leadEvents)
        .values({ leadId: lead.id, campaignId: lead.campaignId, type: 'dropped' });
      await tx
        .update(schema.bookings)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(schema.bookings.leadId, lead.id),
            inArray(schema.bookings.status, [...CAPACITY_STATUSES]),
            typeof keep === 'string' ? sql`${schema.bookings.id}::text <> ${keep}` : undefined,
          ),
        );
      return true;
    });
    if (did) dropped++;
  }
  return dropped;
}
