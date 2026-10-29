import { eq } from 'drizzle-orm';
import { Router } from 'express';
import type { AppDb } from '../auth/auth.js';
import { requireAuth } from '../auth/guards.js';
import * as schema from '../db/schema/index.js';

export function meRouter(db: AppDb) {
  const router = Router();

  router.get('/me', requireAuth, async (req, res) => {
    const ctx = req.ctx!;
    let business = null;
    if (ctx.organizationId) {
      const [row] = await db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          timezone: schema.businessSettings.timezone,
          roleLabels: schema.businessSettings.roleLabels,
        })
        .from(schema.organization)
        .leftJoin(
          schema.businessSettings,
          eq(schema.businessSettings.organizationId, schema.organization.id),
        )
        .where(eq(schema.organization.id, ctx.organizationId))
        .limit(1);
      if (row) {
        business = {
          id: row.id,
          name: row.name,
          slug: row.slug,
          timezone: row.timezone,
          roleLabel: (ctx.role && row.roleLabels?.[ctx.role]) || null,
        };
      }
    }
    res.json({
      user: ctx.user,
      isPlatformAdmin: ctx.isPlatformAdmin,
      impersonatedBy: ctx.impersonatedBy,
      business,
      role: ctx.role,
    });
  });

  return router;
}
