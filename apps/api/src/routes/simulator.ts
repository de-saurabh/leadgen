import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDb } from '../auth/auth.js';
import { businessScope, requirePermission } from '../auth/guards.js';
import * as schema from '../db/schema/index.js';
import type { ConversationService } from '../services/conversations.js';
import { createLead, loadPublishedCampaign } from '../services/leads.js';
import { isSimulatorPhone, newSimulatorPhone } from '../whatsapp/simulator.js';

const StartBody = z.object({
  campaignId: z.uuid(),
  name: z.string().trim().min(1).max(80).default('Test customer'),
});

const ReplyBody = z.union([
  z.object({ text: z.string().trim().min(1).max(1000) }),
  z.object({ replyId: z.string().min(1).max(256), title: z.string().max(100).default('') }),
]);

/**
 * A try-it-yourself chat: plays a customer with a made-up number against a published
 * campaign. Everything runs through the real engine; only the send to Meta is skipped.
 */
export function simulatorRouter(db: AppDb, conversations?: ConversationService) {
  const router = Router();
  const use = requirePermission({ campaign: ['update'] });

  router.post('/simulator/start', use, async (req, res) => {
    const body = StartBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    if (!conversations) {
      res.status(503).json({ error: 'whatsapp_disabled' });
      return;
    }
    const { organizationId } = businessScope(req.ctx);
    const [row] = await db
      .select({ slug: schema.campaigns.slug })
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, body.data.campaignId),
          eq(schema.campaigns.organizationId, organizationId),
        ),
      );
    const campaign = row ? await loadPublishedCampaign(db, row.slug) : undefined;
    if (!campaign || !campaign.whatsappNumberId) {
      res.status(409).json({
        error: 'not_ready',
        message: 'Publish the campaign and pick a WhatsApp number first.',
      });
      return;
    }
    const lead = await createLead(db, {
      campaign,
      name: body.data.name,
      phone: newSimulatorPhone(),
      answers: {},
      source: 'link',
      utm: {},
    });
    await conversations.sendOpeningTemplate(lead.id);
    res.status(201).json({ leadId: lead.id });
  });

  router.post('/simulator/:leadId/reply', use, async (req, res) => {
    const body = ReplyBody.safeParse(req.body);
    if (!body.success || !z.uuid().safeParse(req.params.leadId).success) {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    if (!conversations) {
      res.status(503).json({ error: 'whatsapp_disabled' });
      return;
    }
    const { organizationId } = businessScope(req.ctx);
    const [row] = await db
      .select({ phone: schema.leads.phone, phoneNumberId: schema.whatsappNumbers.phoneNumberId })
      .from(schema.leads)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
      .innerJoin(
        schema.whatsappNumbers,
        eq(schema.whatsappNumbers.id, schema.campaigns.whatsappNumberId),
      )
      .where(
        and(
          eq(schema.leads.id, String(req.params.leadId)),
          eq(schema.leads.organizationId, organizationId),
        ),
      );
    if (!row || !isSimulatorPhone(row.phone)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const isText = 'text' in body.data;
    await conversations.handleWebhook({
      statuses: [],
      messages: [
        {
          phoneNumberId: row.phoneNumberId,
          waMessageId: `sim.in.${randomUUID()}`,
          from: row.phone,
          type: isText ? 'text' : 'interactive',
          message:
            'text' in body.data
              ? { kind: 'text', body: body.data.text }
              : { kind: 'reply', id: body.data.replyId, title: body.data.title },
        },
      ],
    });
    res.json({ ok: true });
  });

  return router;
}
