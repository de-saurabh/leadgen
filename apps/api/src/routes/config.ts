import { Router } from 'express';
import { requireAuth } from '../auth/guards.js';

export interface PublicConfig {
  /** Where customers reach the API's public pages (form links, QR codes). */
  publicUrl: string;
  /** `test` sends only Meta's hello_world as the opening template. */
  templateMode: 'test' | 'live';
}

export function configRouter(config: PublicConfig) {
  const router = Router();
  router.get('/config', requireAuth, (_req, res) => {
    res.json(config);
  });
  return router;
}
