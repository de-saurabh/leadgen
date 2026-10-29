import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDb } from '../auth/auth.js';
import { businessScope, requirePermission } from '../auth/guards.js';
import * as schema from '../db/schema/index.js';

const UpdateBusinessBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'unknown timezone')
    .optional(),
  defaultCountryCode: z
    .string()
    .regex(/^\d{1,3}$/)
    .optional(),
  roleLabels: z
    .object({
      owner: z.string().trim().min(1).max(40),
      manager: z.string().trim().min(1).max(40),
      member: z.string().trim().min(1).max(40),
    })
    .partial()
    .optional(),
});

async function loadBusiness(db: AppDb, organizationId: string) {
  const [row] = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      timezone: schema.businessSettings.timezone,
      defaultCountryCode: schema.businessSettings.defaultCountryCode,
      roleLabels: schema.businessSettings.roleLabels,
    })
    .from(schema.organization)
    .innerJoin(
      schema.businessSettings,
      eq(schema.businessSettings.organizationId, schema.organization.id),
    )
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return row;
}

export function businessRouter(db: AppDb) {
  const router = Router();

  router.get('/business', requirePermission({ settings: ['read'] }), async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const business = await loadBusiness(db, organizationId);
    if (!business) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ business });
  });

  router.patch('/business', requirePermission({ settings: ['update'] }), async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const body = UpdateBusinessBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    const { name, roleLabels, ...settings } = body.data;

    const current = await loadBusiness(db, organizationId);
    if (!current) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    await db.transaction(async (tx) => {
      if (name) {
        await tx
          .update(schema.organization)
          .set({ name })
          .where(eq(schema.organization.id, organizationId));
      }
      await tx
        .update(schema.businessSettings)
        .set({
          ...settings,
          ...(roleLabels && { roleLabels: { ...current.roleLabels, ...roleLabels } }),
        })
        .where(eq(schema.businessSettings.organizationId, organizationId));
    });
    res.json({ business: await loadBusiness(db, organizationId) });
  });

  return router;
}
