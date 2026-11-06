import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { ac, PLATFORM_ADMIN_ROLE, roles } from '@leadgen/shared';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { admin, organization } from 'better-auth/plugins';
import { asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Env } from '../env.js';
import * as schema from '../db/schema/index.js';

/**
 * Endpoints that must not be reachable over HTTP. Accounts and businesses are created by the
 * platform admin through our own routes, which call the same functions server-side (no HTTP
 * request involved, so the hook below lets them through).
 */
const HTTP_BLOCKED_PATHS = new Set([
  '/sign-up/email',
  '/organization/create',
  '/organization/delete',
]);

export type AppDb = NodePgDatabase<typeof schema>;

/** How long an admin "view as" session lasts. */
export const IMPERSONATION_SECONDS = 30 * 60;

export function createAuth(
  db: AppDb,
  env: Pick<Env, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'WEB_ORIGIN'>,
) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN, env.BETTER_AUTH_URL],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    // autoSignIn off: server-side user creation (admin tooling, seeds) must not open sessions.
    emailAndPassword: { enabled: true, autoSignIn: false },
    plugins: [
      admin({
        adminRoles: [PLATFORM_ADMIN_ROLE],
        impersonationSessionDuration: IMPERSONATION_SECONDS,
      }),
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        // Businesses are created by the platform admin through our own service; the public
        // HTTP route for it is blocked in the Express layer.
        allowUserToCreateOrganization: true,
      }),
    ],
    hooks: {
      // Everything an admin does when viewing as someone is recorded.
      after: createAuthMiddleware(async (ctx) => {
        const started = ctx.path === '/admin/impersonate-user';
        const stopped = ctx.path === '/admin/stop-impersonating';
        if (!started && !stopped) return;
        try {
          const session = ctx.context.session;
          if (started) {
            const targetUserId = (ctx.body as { userId?: string } | undefined)?.userId;
            if (!session || !targetUserId) return;
            const [membership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, targetUserId))
              .limit(1);
            await db.insert(schema.auditLog).values({
              actorUserId: session.user.id,
              targetUserId,
              organizationId: membership?.organizationId ?? null,
              action: 'impersonation_started',
              detail: { expiresInSeconds: IMPERSONATION_SECONDS },
            });
          } else if (session?.session.impersonatedBy) {
            await db.insert(schema.auditLog).values({
              actorUserId: session.session.impersonatedBy,
              targetUserId: session.user.id,
              organizationId: session.session.activeOrganizationId ?? null,
              action: 'impersonation_stopped',
            });
          }
        } catch {
          // Auditing must never stop someone from signing out of a view-as session.
        }
      }),
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.request && HTTP_BLOCKED_PATHS.has(ctx.path)) {
          throw new APIError('FORBIDDEN', { message: 'This action is not available.' });
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // Land users in their business: make their first membership the active organization.
          before: async (session) => {
            const [membership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .orderBy(asc(schema.member.createdAt))
              .limit(1);
            return {
              data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
            };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
