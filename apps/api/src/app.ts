import path from 'node:path';
import { toNodeHandler } from 'better-auth/node';
import express, { type ErrorRequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { loadAuthContext } from './auth/context.js';
import type { Auth, AppDb } from './auth/auth.js';
import type { Logger } from './logger.js';
import { adminRouter } from './routes/admin.js';
import { businessRouter } from './routes/business.js';
import { healthRouter } from './routes/health.js';
import { meRouter } from './routes/me.js';

export interface AppDeps {
  logger: Logger;
  db: AppDb;
  auth: Auth;
  pingDb: () => Promise<void>;
  webDistDir?: string | undefined;
}

export function createApp({ logger, db, auth, pingDb, webDistDir }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  // Better Auth reads the raw request body, so it must be mounted before express.json().
  app.all('/api/auth/*splat', toNodeHandler(auth));

  app.use(express.json());

  const api = express.Router();
  api.use(healthRouter(pingDb));
  api.use(loadAuthContext(auth, db));
  api.use(meRouter(db));
  api.use(businessRouter(db));
  api.use('/admin', adminRouter({ auth, db }));
  app.use('/api', api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

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
