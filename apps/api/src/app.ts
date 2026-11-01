import path from 'node:path';
import { toNodeHandler } from 'better-auth/node';
import express, { type ErrorRequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { loadAuthContext } from './auth/context.js';
import type { Auth, AppDb } from './auth/auth.js';
import type { Logger } from './logger.js';
import { adminRouter } from './routes/admin.js';
import { businessRouter } from './routes/business.js';
import { configRouter, type PublicConfig } from './routes/config.js';
import { campaignsRouter } from './routes/campaigns.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';
import { publicFormRouter } from './routes/publicForm.js';
import { webhookRouter } from './routes/webhook.js';
import { whatsappNumbersRouter } from './routes/whatsappNumbers.js';
import type { ConversationService } from './services/conversations.js';
import type { SecretBox } from './services/crypto.js';

export interface AppDeps {
  logger: Logger;
  db: AppDb;
  auth: Auth;
  pingDb: () => Promise<void>;
  /** Encrypts stored WhatsApp tokens; absent when TOKEN_ENCRYPTION_KEY isn't set. */
  secretBox?: SecretBox | undefined;
  /** Called with the new lead id after a form submission is saved. */
  onLeadCreated?: ((leadId: string) => void) | undefined;
  /** Handles inbound WhatsApp messages; webhooks are acknowledged but ignored without it. */
  conversations?: ConversationService | undefined;
  metaVerifyToken?: string | undefined;
  metaAppSecret?: string | undefined;
  publicConfig?: PublicConfig | undefined;
  webDistDir?: string | undefined;
}

export function createApp({
  logger,
  db,
  auth,
  pingDb,
  secretBox,
  onLeadCreated,
  conversations,
  metaVerifyToken,
  metaAppSecret,
  publicConfig = { publicUrl: 'http://localhost:3000', templateMode: 'test' },
  webDistDir,
}: AppDeps) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  // Webhook signatures cover the raw bytes, so it comes before express.json().
  app.use(
    webhookRouter({
      logger,
      verifyToken: metaVerifyToken,
      appSecret: metaAppSecret,
      process: async (parsed) => {
        await conversations?.handleWebhook(parsed);
      },
    }),
  );

  // Better Auth reads the raw request body, so it must be mounted before express.json().
  app.all('/api/auth/*splat', toNodeHandler(auth));

  app.use(express.json());

  const api = express.Router();
  api.use(healthRouter(pingDb));
  api.use(loadAuthContext(auth, db));
  api.use(meRouter(db));
  api.use(configRouter(publicConfig));
  api.use(businessRouter(db));
  api.use(campaignsRouter(db));
  api.use(whatsappNumbersRouter(db, secretBox));
  api.use('/admin', adminRouter({ auth, db }));
  app.use('/api', api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use(publicFormRouter({ db, onLeadCreated }));

  if (webDistDir) {
    const root = path.resolve(webDistDir);
    app.use(express.static(root));
    // SPA fallback: let the dashboard's client-side router handle any other path.
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(root, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    req.log.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);

  return app;
}
