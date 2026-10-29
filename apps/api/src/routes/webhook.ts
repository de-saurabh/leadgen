import express, { Router } from 'express';
import type { Logger } from '../logger.js';
import { parseWebhook, verifySignature, type ParsedWebhook } from '../whatsapp/webhook.js';

export interface WebhookDeps {
  logger: Logger;
  /** The token you typed into Meta's webhook setup. Without it, verification always fails. */
  verifyToken?: string | undefined;
  /** When set, requests without a valid `X-Hub-Signature-256` are rejected. */
  appSecret?: string | undefined;
  /** Receives parsed payloads after the 200 has gone out. */
  process: (parsed: ParsedWebhook) => Promise<void>;
}

/** Mount before `express.json()`: the signature is computed over the raw bytes. */
export function webhookRouter({ logger, verifyToken, appSecret, process }: WebhookDeps) {
  const router = Router();

  router.get('/webhook', (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (
      verifyToken &&
      mode === 'subscribe' &&
      token === verifyToken &&
      typeof challenge === 'string'
    ) {
      res.type('text').send(challenge);
      return;
    }
    res.sendStatus(403);
  });

  router.post('/webhook', express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (appSecret && !verifySignature(raw, req.get('x-hub-signature-256'), appSecret)) {
      logger.warn('webhook rejected: bad signature');
      res.sendStatus(401);
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      res.sendStatus(400);
      return;
    }
    // Meta retries slow or failing responses, so acknowledge first and work afterwards.
    res.sendStatus(200);
    process(parseWebhook(payload)).catch((err) =>
      logger.error({ err }, 'webhook processing failed'),
    );
  });

  return router;
}
