import { BUSINESS_ROLES, PLATFORM_ADMIN_ROLE, type BusinessRole } from '@leadgen/shared';
import { and, eq } from 'drizzle-orm';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import * as schema from '../db/schema/index.js';
import type { Auth, AppDb } from './auth.js';

export interface AuthContext {
  user: { id: string; name: string; email: string; role: string | null };
  isPlatformAdmin: boolean;
  /** Set while a platform admin is "viewing as" this user. */
  impersonatedBy: string | null;
  /** The business this request acts within (the session's active organization). */
  organizationId: string | null;
  /** The user's role in that business; null for the platform admin outside any business. */
  role: BusinessRole | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: AuthContext;
    }
  }
}

function asBusinessRole(value: string | undefined): BusinessRole | null {
  return BUSINESS_ROLES.find((role) => role === value) ?? null;
}

/** Resolves the session (if any) into `req.ctx`. Never rejects; guards decide what's required. */
export function loadAuthContext(auth: Auth, db: AppDb): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (session) {
        const organizationId = session.session.activeOrganizationId ?? null;
        let role: BusinessRole | null = null;
        if (organizationId) {
          const [membership] = await db
            .select({ role: schema.member.role })
            .from(schema.member)
            .where(
              and(
                eq(schema.member.userId, session.user.id),
                eq(schema.member.organizationId, organizationId),
              ),
            )
            .limit(1);
          role = asBusinessRole(membership?.role);
        }
        req.ctx = {
          user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            role: session.user.role ?? null,
          },
          isPlatformAdmin: session.user.role === PLATFORM_ADMIN_ROLE,
          impersonatedBy: session.session.impersonatedBy ?? null,
          // A membership that no longer exists must not leave a dangling business context.
          organizationId: role ? organizationId : null,
          role,
        };
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
