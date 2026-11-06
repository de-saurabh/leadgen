import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AppDb } from '../auth/auth.js';
import { businessScope, requirePermission } from '../auth/guards.js';
import { LEAD_STATUSES } from '../db/schema/leads.js';
import { LeadError, type ConversationService } from '../services/conversations.js';
import { getLead, listLeads } from '../services/leadQueries.js';

const ListQuery = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  campaignId: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
});

const ReplyBody = z.object({ text: z.string().trim().min(1).max(4000) });

const STATUS = { not_found: 404, window_closed: 409, bad_state: 409 } as const;

function fail(res: Response, err: unknown) {
  if (err instanceof LeadError) {
    res.status(STATUS[err.code]).json({ error: err.code, message: err.message });
    return;
  }
  throw err;
}

export function leadsRouter(db: AppDb, conversations?: ConversationService) {
  const router = Router();
  const read = requirePermission({ lead: ['read'] });
  const reply = requirePermission({ inbox: ['reply'] });
  const update = requirePermission({ lead: ['update'] });

  router.get('/leads', read, async (req, res) => {
    const query = ListQuery.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(query.error) });
      return;
    }
    const { organizationId } = businessScope(req.ctx);
    res.json({ leads: await listLeads(db, organizationId, query.data) });
  });

  router.get('/leads/:id', read, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    const found = z.uuid().safeParse(req.params.id).success
      ? await getLead(db, organizationId, String(req.params.id))
      : undefined;
    if (!found) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(found);
  });

  router.post('/leads/:id/reply', reply, async (req, res) => {
    const body = ReplyBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    if (!conversations) {
      res.status(503).json({ error: 'whatsapp_disabled' });
      return;
    }
    const { organizationId, userId } = businessScope(req.ctx);
    try {
      await conversations.staffReply({
        organizationId,
        leadId: String(req.params.id),
        userId,
        text: body.data.text,
      });
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/leads/:id/hand-back', reply, async (req, res) => {
    if (!conversations) {
      res.status(503).json({ error: 'whatsapp_disabled' });
      return;
    }
    const { organizationId } = businessScope(req.ctx);
    try {
      await conversations.handBack({ organizationId, leadId: String(req.params.id) });
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  router.post('/leads/:id/close', update, async (req, res) => {
    if (!conversations) {
      res.status(503).json({ error: 'whatsapp_disabled' });
      return;
    }
    const { organizationId } = businessScope(req.ctx);
    try {
      await conversations.closeLead({ organizationId, leadId: String(req.params.id) });
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
