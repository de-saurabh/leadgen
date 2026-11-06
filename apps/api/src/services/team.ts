import { randomBytes } from 'node:crypto';
import { asc, and, eq, sql } from 'drizzle-orm';
import type { Auth, AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';

export class TeamError extends Error {
  constructor(
    public readonly code: 'not_found' | 'already_member' | 'invalid' | 'create_failed',
    message: string,
  ) {
    super(message);
  }
}

export const ASSIGNABLE_ROLES = ['owner', 'manager', 'member'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export async function listTeam(db: AppDb, organizationId: string) {
  const rows = await db
    .select({
      memberId: schema.member.id,
      userId: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, organizationId))
    .orderBy(asc(schema.member.createdAt));
  const linked = await db
    .select({
      id: schema.resources.id,
      name: schema.resources.name,
      userId: schema.resources.memberUserId,
    })
    .from(schema.resources)
    .where(eq(schema.resources.organizationId, organizationId));
  return rows.map((r) => ({
    ...r,
    resources: linked.filter((l) => l.userId === r.userId).map((l) => ({ id: l.id, name: l.name })),
  }));
}

/**
 * Adds someone to the business. There is no email in the POC, so a new person gets a
 * generated password that is returned once for the owner to hand over.
 */
export async function addTeamMember(
  { auth, db }: { auth: Auth; db: AppDb },
  organizationId: string,
  input: { name: string; email: string; role: AssignableRole },
) {
  const email = input.email.toLowerCase();
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  let userId: string;
  let generatedPassword: string | undefined;
  if (existing) {
    const [already] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, existing.id),
        ),
      )
      .limit(1);
    if (already) throw new TeamError('already_member', 'They are already on the team.');
    userId = existing.id;
  } else {
    generatedPassword = randomBytes(9).toString('base64url');
    try {
      // Server-side, so the HTTP-only sign-up block does not apply; no session is opened.
      const created = await auth.api.signUpEmail({
        body: { email, password: generatedPassword, name: input.name },
      });
      userId = created.user.id;
    } catch (err) {
      throw new TeamError(
        'create_failed',
        err instanceof Error ? err.message : 'could not create the account',
      );
    }
  }
  await auth.api.addMember({ body: { userId, role: input.role, organizationId } });
  return { userId, ...(generatedPassword && { generatedPassword }) };
}

async function ownerCount(db: AppDb, organizationId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.role, 'owner')));
  return row?.n ?? 0;
}

async function findMember(db: AppDb, organizationId: string, memberId: string) {
  const [row] = await db
    .select()
    .from(schema.member)
    .where(and(eq(schema.member.id, memberId), eq(schema.member.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new TeamError('not_found', 'member not found');
  return row;
}

export async function changeRole(
  db: AppDb,
  organizationId: string,
  memberId: string,
  role: AssignableRole,
) {
  const row = await findMember(db, organizationId, memberId);
  if (row.role === 'owner' && role !== 'owner' && (await ownerCount(db, organizationId)) <= 1) {
    throw new TeamError('invalid', 'A business needs at least one owner.');
  }
  await db.update(schema.member).set({ role }).where(eq(schema.member.id, memberId));
}

export async function removeMember(
  db: AppDb,
  organizationId: string,
  memberId: string,
  actingUserId: string,
) {
  const row = await findMember(db, organizationId, memberId);
  if (row.userId === actingUserId) throw new TeamError('invalid', 'You cannot remove yourself.');
  if (row.role === 'owner' && (await ownerCount(db, organizationId)) <= 1) {
    throw new TeamError('invalid', 'A business needs at least one owner.');
  }
  await db.transaction(async (tx) => {
    await tx
      .update(schema.resources)
      .set({ memberUserId: null })
      .where(
        and(
          eq(schema.resources.organizationId, organizationId),
          eq(schema.resources.memberUserId, row.userId),
        ),
      );
    await tx.delete(schema.member).where(eq(schema.member.id, memberId));
  });
}
