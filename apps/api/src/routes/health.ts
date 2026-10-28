import { Router } from 'express';

export function healthRouter(pingDb: () => Promise<void>) {
  const router = Router();

  router.get('/health', async (req, res) => {
    try {
      await pingDb();
      res.json({ status: 'ok', db: 'ok' });
    } catch (err) {
      req.log.error({ err }, 'health check: database unreachable');
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  return router;
}
