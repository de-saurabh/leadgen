import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppDb } from '../auth/auth.js';
import { businessScope, requirePermission } from '../auth/guards.js';
import { BOOKING_STATUSES } from '../db/schema/booking.js';
import { BookingError, changeBookingStatus, listBookings } from '../services/bookings.js';
import type { ConversationService } from '../services/conversations.js';
import type { EventBus } from '../services/events.js';

const ListQuery = z.object({
  status: z.enum(BOOKING_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const ChangeBody = z.object({ status: z.enum(BOOKING_STATUSES) });

/** Statuses the customer is told about. */
const NOTIFIED = ['confirmed', 'rejected', 'cancelled'] as const;
type Notified = (typeof NOTIFIED)[number];

const STATUS = { not_found: 404, invalid_transition: 409 } as const;

function fail(res: Response, err: unknown) {
  if (err instanceof BookingError) {
    res.status(STATUS[err.code]).json({ error: err.code, message: err.message });
    return;
  }
  throw err;
}

export function bookingsRouter(db: AppDb, conversations?: ConversationService, bus?: EventBus) {
  const router = Router();
  const read = requirePermission({ booking: ['read'] });
  const update = requirePermission({ booking: ['update'] });

  router.get('/bookings', read, async (req, res) => {
    const query = ListQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(query.error) });
      return;
    }
    res.json({ bookings: await listBookings(db, businessScope(req.ctx), query.data) });
  });

  router.patch('/bookings/:id', update, async (req, res) => {
    const body = ChangeBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    try {
      const booking = await changeBookingStatus(
        db,
        businessScope(req.ctx),
        String(req.params.id),
        body.data.status,
      );
      let notified = false;
      if (conversations && (NOTIFIED as readonly string[]).includes(booking.status)) {
        notified = await conversations
          .notifyBooking(booking.id, booking.status as Notified)
          .catch((err: unknown) => {
            req.log.warn({ err }, 'could not tell the customer about the booking change');
            return false;
          });
      }
      bus?.publish(booking.organizationId, { type: 'booking', bookingId: booking.id });
      res.json({ booking, notified });
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
