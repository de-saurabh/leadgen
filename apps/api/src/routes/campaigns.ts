import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppDb } from '../auth/auth.js';
import { businessScope, requirePermission } from '../auth/guards.js';
import {
  CampaignError,
  SLUG_PATTERN,
  createCampaign,
  getCampaign,
  listCampaigns,
  publishCampaign,
  updateCampaignDraft,
} from '../services/campaigns.js';

// The draft is deliberately loose: it may be half-finished. Publishing validates it fully.
const Draft = z.object({
  questions: z.array(z.unknown()),
  settings: z.record(z.string(), z.unknown()),
});

const CreateBody = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().regex(SLUG_PATTERN).max(48).optional(),
  whatsappNumberId: z.uuid().optional(),
  draft: Draft,
});

const UpdateBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  whatsappNumberId: z.uuid().optional(),
  draft: Draft.optional(),
});

const STATUS = { slug_taken: 409, not_found: 404, invalid: 422, no_number: 422 } as const;

function sendError(res: Response, err: unknown) {
  if (err instanceof CampaignError) {
    res
      .status(STATUS[err.code])
      .json({ error: err.code, message: err.message, issues: err.issues });
    return;
  }
  throw err;
}

export function campaignsRouter(db: AppDb) {
  const router = Router();

  router.get('/campaigns', requirePermission({ campaign: ['read'] }), async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    res.json({ campaigns: await listCampaigns(db, organizationId) });
  });

  router.get('/campaigns/:id', requirePermission({ campaign: ['read'] }), async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const campaign = await getCampaign(db, organizationId, String(req.params.id));
    if (!campaign) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ campaign });
  });

  router.post('/campaigns', requirePermission({ campaign: ['create'] }), async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const body = CreateBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    try {
      const campaign = await createCampaign(db, organizationId, {
        ...body.data,
        draft: body.data.draft as never,
      });
      res.status(201).json({ campaign });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch('/campaigns/:id', requirePermission({ campaign: ['update'] }), async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const body = UpdateBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    try {
      const campaign = await updateCampaignDraft(db, organizationId, String(req.params.id), {
        ...body.data,
        draft: body.data.draft as never,
      });
      res.json({ campaign });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post(
    '/campaigns/:id/publish',
    requirePermission({ campaign: ['publish'] }),
    async (req, res) => {
      const { organizationId, userId } = businessScope(req.ctx);
      try {
        const { versionId, version, warnings } = await publishCampaign(
          db,
          organizationId,
          String(req.params.id),
          userId,
        );
        res.json({ versionId, version, warnings });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  return router;
}
