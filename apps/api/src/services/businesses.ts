import { randomBytes } from 'node:crypto';
import { count, desc, eq } from 'drizzle-orm';
import type { Auth, AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';

export class BusinessError extends Error {
  constructor(
    public readonly code: 'slug_taken' | 'owner_create_failed' | 'business_create_failed',
    message: string,
  ) {
    super(message);
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export interface CreateBusinessInput {
  name: string;
  slug?: string | undefined;
  timezone: string;
  defaultCountryCode: string;
  owner: { name: string; email: string; password?: string | undefined };
}

export interface CreatedBusiness {
  id: string;
  slug: string;
  name: string;
  ownerUserId: string;
  /** Only present when we generated it (new owner, no password supplied). Shown once. */
  generatedOwnerPassword?: string;
}

/**
 * Creates a business (Better Auth organization), its settings row and its owner account.
 * The owner is a regular user; an existing user with that email is reused as owner.
 * `adminHeaders` are the platform admin's request headers, used to call admin-only user APIs.
 */
export async function createBusiness(
  { auth, db }: { auth: Auth; db: AppDb },
  adminHeaders: Headers,
  input: CreateBusinessInput,
): Promise<CreatedBusiness> {
  const slug = input.slug ?? slugify(input.name);
  if (!slug) throw new BusinessError('slug_taken', 'could not derive a slug from the name');

  const [taken] = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.slug, slug))
    .limit(1);
  if (taken) throw new BusinessError('slug_taken', `slug "${slug}" is already in use`);

  const email = input.owner.email.toLowerCase();
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  let ownerUserId: string;
  let generatedOwnerPassword: string | undefined;
  let createdOwner = false;
  if (existing) {
    ownerUserId = existing.id;
  } else {
    const password =
      input.owner.password ?? (generatedOwnerPassword = randomBytes(9).toString('base64url'));
    try {
      const { user } = await auth.api.createUser({
        headers: adminHeaders,
        body: { email, password, name: input.owner.name, role: 'user' },
      });
      ownerUserId = user.id;
      createdOwner = true;
    } catch (err) {
      throw new BusinessError(
        'owner_create_failed',
        err instanceof Error ? err.message : 'owner create failed',
      );
    }
  }

  let organizationId: string | undefined;
  try {
    // Server-side call with `userId`: the creator becomes the business owner.
    const organization = await auth.api.createOrganization({
      body: { name: input.name, slug, userId: ownerUserId, keepCurrentActiveOrganization: true },
    });
    organizationId = organization.id;
    await db.insert(schema.businessSettings).values({
      organizationId,
      timezone: input.timezone,
      defaultCountryCode: input.defaultCountryCode,
    });
  } catch (err) {
    // Better Auth calls can't share a transaction; undo what we created.
    if (organizationId)
      await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
    if (createdOwner) await db.delete(schema.user).where(eq(schema.user.id, ownerUserId));
    throw new BusinessError(
      'business_create_failed',
      err instanceof Error ? err.message : 'business create failed',
    );
  }

  return {
    id: organizationId,
    slug,
    name: input.name,
    ownerUserId,
    ...(generatedOwnerPassword && { generatedOwnerPassword }),
  };
}

export interface BusinessSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string | null;
  memberCount: number;
  createdAt: Date;
}

export async function listBusinesses(db: AppDb): Promise<BusinessSummary[]> {
  const memberCounts = db
    .select({
      organizationId: schema.member.organizationId,
      memberCount: count().as('member_count'),
    })
    .from(schema.member)
    .groupBy(schema.member.organizationId)
    .as('member_counts');

  const rows = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      timezone: schema.businessSettings.timezone,
      memberCount: memberCounts.memberCount,
      createdAt: schema.organization.createdAt,
    })
    .from(schema.organization)
    .leftJoin(
      schema.businessSettings,
      eq(schema.businessSettings.organizationId, schema.organization.id),
    )
    .leftJoin(memberCounts, eq(memberCounts.organizationId, schema.organization.id))
    .orderBy(desc(schema.organization.createdAt));

  return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount ?? 0) }));
}
