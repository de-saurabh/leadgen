import { fromNodeHeaders } from 'better-auth/node';
import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as schema from '../db/schema/index.js';
import { Router } from 'express';
import { z } from 'zod';
import type { Auth, AppDb } from '../auth/auth.js';
import { requirePlatformAdmin } from '../auth/guards.js';
import { BusinessError, createBusiness, listBusinesses } from '../services/businesses.js';

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'unknown timezone');

const CreateBusinessBody = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, numbers and dashes')
    .max(48)
    .optional(),
  timezone: timezone.default('Asia/Kolkata'),
  defaultCountryCode: z
    .string()
    .regex(/^\d{1,3}$/)
    .default('91'),
  owner: z.object({
    name: z.string().trim().min(1).max(80),
    email: z.email(),
    password: z.string().min(8).optional(),
  }),
});

export function adminRouter(deps: { auth: Auth; db: AppDb }) {
  const router = Router();
  router.use(requirePlatformAdmin);

  router.get('/audit', async (_req, res) => {
    const actor = alias(schema.user, 'actor');
    const rows = await deps.db
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        detail: schema.auditLog.detail,
        at: schema.auditLog.at,
        actorName: actor.name,
        targetName: schema.user.name,
        businessName: schema.organization.name,
      })
      .from(schema.auditLog)
      .leftJoin(actor, eq(actor.id, schema.auditLog.actorUserId))
      .leftJoin(schema.user, eq(schema.user.id, schema.auditLog.targetUserId))
      .leftJoin(schema.organization, eq(schema.organization.id, schema.auditLog.organizationId))
      .orderBy(desc(schema.auditLog.at))
      .limit(100);
    res.json({ entries: rows });
  });

  router.get('/businesses', async (_req, res) => {
    res.json({ businesses: await listBusinesses(deps.db) });
  });

  router.post('/businesses', async (req, res) => {
    const body = CreateBusinessBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    try {
      const business = await createBusiness(deps, fromNodeHeaders(req.headers), body.data);
      res.status(201).json({ business });
    } catch (err) {
      if (err instanceof BusinessError) {
        res
          .status(err.code === 'slug_taken' ? 409 : 422)
          .json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
