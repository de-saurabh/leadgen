import { Router } from 'express';
import { requireAuth } from '../auth/guards.js';
import type { EventBus } from '../services/events.js';

/** Server-sent events for the signed-in user's business. */
export function streamRouter(bus: EventBus) {
  const router = Router();

  router.get('/stream', requireAuth, (req, res) => {
    const organizationId = req.ctx!.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Keeps reverse proxies from buffering the stream.
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');

    const unsubscribe = bus.subscribe(organizationId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    // Comments keep idle connections from being closed by proxies.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}
