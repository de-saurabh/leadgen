import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppDb } from '../auth/auth.js';
import { businessScope, requirePermission } from '../auth/guards.js';
import { RESOURCE_KINDS } from '../db/schema/booking.js';
import {
  ResourceError,
  addTimeOff,
  createEvent,
  createResource,
  deleteEvent,
  deleteResource,
  getOfferings,
  listEvents,
  listResources,
  removeTimeOff,
  setOfferings,
  updateEvent,
  updateResource,
} from '../services/resources.js';

const Hours = z.object({
  weekday: z.number().int().min(1).max(7),
  startMinute: z.number().int().min(0).max(1440),
  endMinute: z.number().int().min(0).max(1440),
});

const ResourceBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(RESOURCE_KINDS),
  capacity: z.number().int().min(1).max(500),
  slotMinutes: z.number().int().min(5).max(480),
  memberUserId: z.string().min(1).nullable().optional(),
  active: z.boolean().optional(),
  hours: z.array(Hours).max(70).optional(),
});

const TimeOffBody = z.object({
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().trim().max(200).optional(),
});

const EventBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  capacity: z.number().int().min(1).max(10_000),
  active: z.boolean().optional(),
});

const OfferingsBody = z.object({
  resourceIds: z.array(z.uuid()).max(100),
  eventIds: z.array(z.uuid()).max(100),
});

const STATUS = { not_found: 404, invalid: 422, in_use: 409 } as const;

function fail(res: Response, err: unknown) {
  if (err instanceof ResourceError) {
    res.status(STATUS[err.code]).json({ error: err.code, message: err.message });
    return;
  }
  throw err;
}

export function resourcesRouter(db: AppDb) {
  const router = Router();
  const read = requirePermission({ resource: ['read'] });
  const create = requirePermission({ resource: ['create'] });
  const update = requirePermission({ resource: ['update'] });
  const remove = requirePermission({ resource: ['delete'] });
  const bad = (res: Response, error: z.ZodError) =>
    res.status(400).json({ error: 'invalid_request', issues: z.flattenError(error) });

  router.get('/resources', read, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    res.json({ resources: await listResources(db, organizationId) });
  });

  router.post('/resources', create, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const body = ResourceBody.safeParse(req.body);
    if (!body.success) return void bad(res, body.error);
    try {
      res.status(201).json({ resource: await createResource(db, organizationId, body.data) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.patch('/resources/:id', update, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const body = ResourceBody.partial().safeParse(req.body);
    if (!body.success) return void bad(res, body.error);
    try {
      res.json({
        resource: await updateResource(db, organizationId, String(req.params.id), body.data),
      });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/resources/:id', remove, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    try {
      await deleteResource(db, organizationId, String(req.params.id));
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/resources/:id/time-off', update, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const body = TimeOffBody.safeParse(req.body);
    if (!body.success) return void bad(res, body.error);
    try {
      res
        .status(201)
        .json({ timeOff: await addTimeOff(db, organizationId, String(req.params.id), body.data) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/resources/:id/time-off/:timeOffId', update, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    try {
      await removeTimeOff(db, organizationId, String(req.params.id), String(req.params.timeOffId));
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  router.get('/events', read, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    res.json({ events: await listEvents(db, organizationId) });
  });

  router.post('/events', create, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const body = EventBody.safeParse(req.body);
    if (!body.success) return void bad(res, body.error);
    try {
      res.status(201).json({ event: await createEvent(db, organizationId, body.data) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.patch('/events/:id', update, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const body = EventBody.partial().safeParse(req.body);
    if (!body.success) return void bad(res, body.error);
    try {
      res.json({ event: await updateEvent(db, organizationId, String(req.params.id), body.data) });
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/events/:id', remove, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    try {
      await deleteEvent(db, organizationId, String(req.params.id));
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  router.get(
    '/campaigns/:id/offerings',
    requirePermission({ campaign: ['read'] }),
    async (req, res) => {
      const { organizationId } = businessScope(req.ctx);
      try {
        res.json(await getOfferings(db, organizationId, String(req.params.id)));
      } catch (err) {
        fail(res, err);
      }
    },
  );

  router.put(
    '/campaigns/:id/offerings',
    requirePermission({ campaign: ['update'] }),
    async (req, res) => {
      const { organizationId } = businessScope(req.ctx);
      const body = OfferingsBody.safeParse(req.body);
      if (!body.success) return void bad(res, body.error);
      try {
        res.json(await setOfferings(db, organizationId, String(req.params.id), body.data));
      } catch (err) {
        fail(res, err);
      }
    },
  );

  return router;
}
