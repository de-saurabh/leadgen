import { roleCan, type Permissions } from '@leadgen/shared';
import type { RequestHandler } from 'express';
import type { AuthContext } from './context.js';

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.ctx) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  next();
};

export const requirePlatformAdmin: RequestHandler = (req, res, next) => {
  if (!req.ctx) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  if (!req.ctx.isPlatformAdmin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
};

/** Requires a signed-in user acting within a business whose role grants the given permissions. */
export function requirePermission(permissions: Permissions): RequestHandler {
  return (req, res, next) => {
    if (!req.ctx) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (!req.ctx.role || !roleCan(req.ctx.role, permissions)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

/** For handlers behind `requirePermission`: the business the request acts within. */
export function businessScope(ctx: AuthContext | undefined) {
  if (!ctx?.organizationId || !ctx.role)
    throw new Error('businessScope used without a business context');
  return { organizationId: ctx.organizationId, role: ctx.role, userId: ctx.user.id };
}
