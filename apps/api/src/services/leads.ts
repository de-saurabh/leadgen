import type { Answers, CampaignConfig } from '@leadgen/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';

export const SOURCES = ['link', 'qr', 'embed'] as const;
export type Source = (typeof SOURCES)[number];

export interface PublishedCampaign {
  campaignId: string;
  campaignName: string;
  organizationId: string;
  businessName: string;
  defaultCountryCode: string;
  versionId: string;
  config: CampaignConfig;
  whatsappNumberId: string | null;
  /** Digits the customer messages, for the wa.me link. */
  whatsappDisplayNumber: string | null;
}

/** The live version of a campaign by its public slug, or undefined when it isn't published. */
export async function loadPublishedCampaign(
  db: AppDb,
  slug: string,
): Promise<PublishedCampaign | undefined> {
  const [row] = await db
    .select({
      campaignId: schema.campaigns.id,
      campaignName: schema.campaigns.name,
      organizationId: schema.campaigns.organizationId,
      businessName: schema.organization.name,
      defaultCountryCode: schema.businessSettings.defaultCountryCode,
      versionId: schema.campaignVersions.id,
      config: schema.campaignVersions.config,
      whatsappNumberId: schema.campaigns.whatsappNumberId,
      whatsappDisplayNumber: schema.whatsappNumbers.displayNumber,
    })
    .from(schema.campaigns)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.campaigns.organizationId))
    .innerJoin(
      schema.businessSettings,
      eq(schema.businessSettings.organizationId, schema.campaigns.organizationId),
    )
    .innerJoin(
      schema.campaignVersions,
      eq(schema.campaignVersions.id, schema.campaigns.publishedVersionId),
    )
    .leftJoin(
      schema.whatsappNumbers,
      eq(schema.whatsappNumbers.id, schema.campaigns.whatsappNumberId),
    )
    .where(and(eq(schema.campaigns.slug, slug), eq(schema.campaigns.status, 'published')))
    .limit(1);
  return row;
}

export const ACTIVE_STATUSES = ['new', 'in_conversation'] as const;

export interface NewLead {
  campaign: PublishedCampaign;
  name: string;
  phone: string;
  answers: Answers;
  source: Source;
  utm: Record<string, string>;
}

/**
 * Saves a form submission as a lead on the campaign's current version. A person submitting
 * again replaces their earlier unfinished conversation in the same campaign.
 */
export async function createLead(db: AppDb, input: NewLead) {
  const { campaign } = input;
  return db.transaction(async (tx) => {
    const dropped = await tx
      .update(schema.leads)
      .set({ status: 'dropped', currentQuestionId: null })
      .where(
        and(
          eq(schema.leads.organizationId, campaign.organizationId),
          eq(schema.leads.campaignId, campaign.campaignId),
          eq(schema.leads.phone, input.phone),
          inArray(schema.leads.status, ACTIVE_STATUSES),
        ),
      )
      .returning({ id: schema.leads.id });
    if (dropped.length > 0) {
      await tx.insert(schema.leadEvents).values(
        dropped.map((d) => ({
          leadId: d.id,
          campaignId: campaign.campaignId,
          type: 'dropped' as const,
        })),
      );
    }

    const [lead] = await tx
      .insert(schema.leads)
      .values({
        organizationId: campaign.organizationId,
        campaignId: campaign.campaignId,
        campaignVersionId: campaign.versionId,
        name: input.name,
        phone: input.phone,
        source: input.source,
        utm: input.utm,
        answers: input.answers,
      })
      .returning();
    await tx
      .insert(schema.leadEvents)
      .values({ leadId: lead!.id, campaignId: campaign.campaignId, type: 'submitted' });
    return lead!;
  });
}
