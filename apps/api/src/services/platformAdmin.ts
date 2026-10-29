import { PLATFORM_ADMIN_ROLE } from '@leadgen/shared';
import { eq } from 'drizzle-orm';
import type { Auth, AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';

/**
 * Makes sure the platform admin account exists with the admin role. Idempotent; never changes
 * the password of an existing account. Returns whether it created the user.
 */
export async function ensurePlatformAdmin(
  { auth, db }: { auth: Auth; db: AppDb },
  { email, password }: { email: string; password: string },
): Promise<{ created: boolean }> {
  const normalized = email.toLowerCase();
  const [existing] = await db
    .select({ id: schema.user.id, role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.email, normalized))
    .limit(1);

  if (existing) {
    if (existing.role !== PLATFORM_ADMIN_ROLE) {
      await db
        .update(schema.user)
        .set({ role: PLATFORM_ADMIN_ROLE })
        .where(eq(schema.user.id, existing.id));
    }
    return { created: false };
  }

  await auth.api.signUpEmail({ body: { name: 'Platform Admin', email: normalized, password } });
  await db
    .update(schema.user)
    .set({ role: PLATFORM_ADMIN_ROLE })
    .where(eq(schema.user.email, normalized));
  return { created: true };
}
