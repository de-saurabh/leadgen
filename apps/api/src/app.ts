import path from 'node:path';
import express from 'express';
import { pinoHttp } from 'pino-http';
import type { Logger } from './logger.js';
import { healthRouter } from './routes/health.js';

export interface AppDeps {
  logger: Logger;
  pingDb: () => Promise<void>;
  webDistDir?: string | undefined;
}

export function createApp({ logger, pingDb, webDistDir }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(express.json());

  const api = express.Router();
  api.use(healthRouter(pingDb));
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

  return app;
}
