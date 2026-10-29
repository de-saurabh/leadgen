import { Router } from 'express';
import { z } from 'zod';
import type { AppDb } from '../auth/auth.js';
import { businessScope, requirePermission } from '../auth/guards.js';
import type { SecretBox } from '../services/crypto.js';
import {
  NumberError,
  connectNumber,
  disconnectNumber,
  listNumbers,
} from '../services/whatsappNumbers.js';

const ConnectBody = z.object({
  phoneNumberId: z.string().regex(/^\d{5,25}$/, 'digits only'),
  wabaId: z
    .string()
    .regex(/^\d{5,25}$/)
    .optional(),
  displayNumber: z.string().regex(/^\+?[\d\s().-]{8,20}$/),
  accessToken: z.string().min(20).max(1000),
});

export function whatsappNumbersRouter(db: AppDb, box: SecretBox | undefined) {
  const router = Router();

  router.get(
    '/whatsapp-numbers',
    requirePermission({ whatsappNumber: ['read'] }),
    async (req, res) => {
      const { organizationId } = businessScope(req.ctx);
      res.json({ numbers: await listNumbers(db, organizationId) });
    },
  );

  router.post(
    '/whatsapp-numbers',
    requirePermission({ settings: ['update'] }),
    async (req, res) => {
      if (!box) {
        res.status(503).json({
          error: 'not_configured',
          message: 'Set TOKEN_ENCRYPTION_KEY on the server before connecting a number.',
        });
        return;
      }
      const { organizationId } = businessScope(req.ctx);
      const body = ConnectBody.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
        return;
      }
      try {
        res.status(201).json({ number: await connectNumber(db, box, organizationId, body.data) });
      } catch (err) {
        if (err instanceof NumberError) {
          res.status(409).json({ error: err.code, message: err.message });
          return;
        }
        throw err;
      }
    },
  );

  router.delete(
    '/whatsapp-numbers/:id',
    requirePermission({ settings: ['update'] }),
    async (req, res) => {
      const { organizationId } = businessScope(req.ctx);
      try {
        await disconnectNumber(db, organizationId, String(req.params.id));
        res.status(204).end();
      } catch (err) {
        if (err instanceof NumberError) {
          res.status(404).json({ error: err.code });
          return;
        }
        throw err;
      }
    },
  );

  return router;
}
