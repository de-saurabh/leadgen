import { Router } from 'express';
import { z } from 'zod';
import type { AppDb } from '../auth/auth.js';
import { businessScope, requirePermission } from '../auth/guards.js';
import { loadAnalytics } from '../services/analytics.js';

const Query = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  campaignId: z.uuid().optional(),
  includeSimulator: z.enum(['true', 'false']).optional(),
});

const DAY = 86_400_000;

export function analyticsRouter(db: AppDb) {
  const router = Router();

  router.get('/analytics', requirePermission({ analytics: ['read'] }), async (req, res) => {
    const query = Query.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(query.error) });
      return;
    }
    const { organizationId } = businessScope(req.ctx);
    // Last 30 days unless told otherwise.
    const to = query.data.to ?? new Date(Date.now() + DAY);
    const from = query.data.from ?? new Date(to.getTime() - 31 * DAY);
    res.json(
      await loadAnalytics(db, organizationId, {
        from,
        to,
        campaignId: query.data.campaignId,
        includeSimulator: query.data.includeSimulator === 'true',
      }),
    );
  });

  return router;
}
