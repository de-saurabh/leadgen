import { fromNodeHeaders } from 'better-auth/node';
import { Router } from 'express';
import { z } from 'zod';
import type { Auth, AppDb } from '../auth/auth.js';
import { requirePlatformAdmin } from '../auth/guards.js';
import { BusinessError, createBusiness, listBusinesses } from '../services/businesses.js';

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'unknown timezone');

const CreateBusinessBody = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, numbers and dashes')
    .max(48)
    .optional(),
  timezone: timezone.default('Asia/Kolkata'),
  defaultCountryCode: z
    .string()
    .regex(/^\d{1,3}$/)
    .default('91'),
  owner: z.object({
    name: z.string().trim().min(1).max(80),
    email: z.email(),
    password: z.string().min(8).optional(),
  }),
});

export function adminRouter(deps: { auth: Auth; db: AppDb }) {
  const router = Router();
  router.use(requirePlatformAdmin);

  router.get('/businesses', async (_req, res) => {
    res.json({ businesses: await listBusinesses(deps.db) });
  });

  router.post('/businesses', async (req, res) => {
    const body = CreateBusinessBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    try {
      const business = await createBusiness(deps, fromNodeHeaders(req.headers), body.data);
      res.status(201).json({ business });
    } catch (err) {
      if (err instanceof BusinessError) {
        res
          .status(err.code === 'slug_taken' ? 409 : 422)
          .json({ error: err.code, message: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
