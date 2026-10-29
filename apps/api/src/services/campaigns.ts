import {
  validateCampaign,
  type CampaignConfig,
  type CampaignConfigInput,
  type ValidationIssue,
} from '@leadgen/shared';
import { and, desc, eq, max } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';
import { slugify } from './businesses.js';

export class CampaignError extends Error {
  constructor(
    public readonly code: 'slug_taken' | 'not_found' | 'invalid' | 'no_number',
    message: string,
    public readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function slugExists(db: AppDb, slug: string) {
  const [row] = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.slug, slug))
    .limit(1);
  return row !== undefined;
}

/** An unused slug derived from the name: `spring-offer`, then `spring-offer-2`, and so on. */
async function freeSlug(db: AppDb, name: string) {
  const base = slugify(name) || 'campaign';
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await slugExists(db, candidate))) return candidate;
  }
  throw new CampaignError('slug_taken', 'could not find a free slug');
}

async function ownedNumberId(db: AppDb, organizationId: string, numberId: string) {
  const [row] = await db
    .select({ id: schema.whatsappNumbers.id })
    .from(schema.whatsappNumbers)
    .where(
      and(
        eq(schema.whatsappNumbers.id, numberId),
        eq(schema.whatsappNumbers.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new CampaignError('not_found', 'WhatsApp number not found');
  return row.id;
}

export interface CreateCampaignInput {
  name: string;
  slug?: string | undefined;
  whatsappNumberId?: string | undefined;
  draft: CampaignConfigInput;
}

export async function createCampaign(
  db: AppDb,
  organizationId: string,
  input: CreateCampaignInput,
) {
  const slug = input.slug ?? (await freeSlug(db, input.name));
  if (input.slug && (await slugExists(db, slug))) {
    throw new CampaignError('slug_taken', `slug "${slug}" is already in use`);
  }
  const whatsappNumberId = input.whatsappNumberId
    ? await ownedNumberId(db, organizationId, input.whatsappNumberId)
    : null;

  const [campaign] = await db
    .insert(schema.campaigns)
    .values({ organizationId, slug, name: input.name, whatsappNumberId, draft: input.draft })
    .returning();
  return campaign!;
}

export async function getCampaign(db: AppDb, organizationId: string, id: string) {
  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.id, id), eq(schema.campaigns.organizationId, organizationId)))
    .limit(1);
  return campaign;
}

export function listCampaigns(db: AppDb, organizationId: string) {
  return db
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      slug: schema.campaigns.slug,
      status: schema.campaigns.status,
      publishedVersionId: schema.campaigns.publishedVersionId,
      updatedAt: schema.campaigns.updatedAt,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.organizationId, organizationId))
    .orderBy(desc(schema.campaigns.updatedAt));
}

export async function updateCampaignDraft(
  db: AppDb,
  organizationId: string,
  id: string,
  patch: {
    name?: string | undefined;
    whatsappNumberId?: string | undefined;
    draft?: CampaignConfigInput | undefined;
  },
) {
  if (!(await getCampaign(db, organizationId, id))) {
    throw new CampaignError('not_found', 'campaign not found');
  }
  const whatsappNumberId = patch.whatsappNumberId
    ? await ownedNumberId(db, organizationId, patch.whatsappNumberId)
    : undefined;
  const [updated] = await db
    .update(schema.campaigns)
    .set({
      ...(patch.name && { name: patch.name }),
      ...(patch.draft && { draft: patch.draft }),
      ...(whatsappNumberId && { whatsappNumberId }),
    })
    .where(eq(schema.campaigns.id, id))
    .returning();
  return updated!;
}

/**
 * Validates the draft and freezes it as the next version. Leads already in conversation
 * keep the version they started on; new form submissions use this one.
 */
export async function publishCampaign(
  db: AppDb,
  organizationId: string,
  id: string,
  publishedBy: string,
): Promise<{
  versionId: string;
  version: number;
  config: CampaignConfig;
  warnings: ValidationIssue[];
}> {
  const campaign = await getCampaign(db, organizationId, id);
  if (!campaign) throw new CampaignError('not_found', 'campaign not found');
  if (!campaign.whatsappNumberId) {
    throw new CampaignError('no_number', 'Choose a WhatsApp number before publishing');
  }
  const result = validateCampaign(campaign.draft);
  if (!result.valid) {
    throw new CampaignError('invalid', 'The campaign has problems to fix', result.issues);
  }

  return db.transaction(async (tx) => {
    // Serialise publishes of one campaign so version numbers stay gapless and unique.
    await tx.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).for('update');
    const [latest] = await tx
      .select({ latest: max(schema.campaignVersions.version) })
      .from(schema.campaignVersions)
      .where(eq(schema.campaignVersions.campaignId, id));
    const version = (latest?.latest ?? 0) + 1;
    const [row] = await tx
      .insert(schema.campaignVersions)
      .values({ campaignId: id, version, config: result.config, publishedBy })
      .returning({ id: schema.campaignVersions.id });
    await tx
      .update(schema.campaigns)
      .set({ publishedVersionId: row!.id, status: 'published' })
      .where(eq(schema.campaigns.id, id));
    return {
      versionId: row!.id,
      version,
      config: result.config,
      warnings: result.issues.filter((i) => i.severity === 'warning'),
    };
  });
}
