import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Auth, AppDb } from '../auth/auth.js';
import { businessScope, requirePermission } from '../auth/guards.js';
import {
  ASSIGNABLE_ROLES,
  TeamError,
  addTeamMember,
  changeRole,
  listTeam,
  removeMember,
} from '../services/team.js';

const AddBody = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email(),
  role: z.enum(ASSIGNABLE_ROLES),
});
const RoleBody = z.object({ role: z.enum(ASSIGNABLE_ROLES) });

const STATUS = { not_found: 404, already_member: 409, invalid: 422, create_failed: 422 } as const;

function fail(res: Response, err: unknown) {
  if (err instanceof TeamError) {
    res.status(STATUS[err.code]).json({ error: err.code, message: err.message });
    return;
  }
  throw err;
}

export function teamRouter({ auth, db }: { auth: Auth; db: AppDb }) {
  const router = Router();
  // Managers can see the team (to link staff to resources); only owners change it.
  const read = requirePermission({ resource: ['read'] });
  const create = requirePermission({ member: ['create'] });
  const update = requirePermission({ member: ['update'] });
  const remove = requirePermission({ member: ['delete'] });

  router.get('/team', read, async (req, res) => {
    const { organizationId } = businessScope(req.ctx);
    res.json({ team: await listTeam(db, organizationId) });
  });

  router.post('/team', create, async (req, res) => {
    const body = AddBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    const { organizationId } = businessScope(req.ctx);
    try {
      res.status(201).json(await addTeamMember({ auth, db }, organizationId, body.data));
    } catch (err) {
      fail(res, err);
    }
  });

  router.patch('/team/:memberId', update, async (req, res) => {
    const body = RoleBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_request', issues: z.flattenError(body.error) });
      return;
    }
    const { organizationId } = businessScope(req.ctx);
    try {
      await changeRole(db, organizationId, String(req.params.memberId), body.data.role);
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  router.delete('/team/:memberId', remove, async (req, res) => {
    const { organizationId, userId } = businessScope(req.ctx);
    try {
      await removeMember(db, organizationId, String(req.params.memberId), userId);
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  });

  return router;
}
