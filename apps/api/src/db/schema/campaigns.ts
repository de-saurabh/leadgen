import type { CampaignConfig, CampaignConfigInput } from '@leadgen/shared';
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organization } from './auth.js';
import { whatsappNumbers } from './whatsapp.js';

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Public form address: /f/:slug. Unique across the platform. */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** The WhatsApp number the campaign talks through. */
    whatsappNumberId: uuid('whatsapp_number_id').references(() => whatsappNumbers.id, {
      onDelete: 'set null',
    }),
    /** Work in progress; may be invalid. Publishing validates it and freezes a copy. */
    draft: jsonb('draft').$type<CampaignConfigInput>().notNull(),
    /** The live version (no FK: versions reference the campaign, so this avoids a cycle). */
    publishedVersionId: uuid('published_version_id'),
    status: text('status', { enum: ['draft', 'published', 'archived'] })
      .notNull()
      .default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('campaigns_org_idx').on(t.organizationId)],
);

/** A frozen, published copy of a campaign. Leads stay on the version they started with. */
export const campaignVersions = pgTable(
  'campaign_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    config: jsonb('config').$type<CampaignConfig>().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: text('published_by'),
  },
  (t) => [unique('campaign_versions_campaign_version_uq').on(t.campaignId, t.version)],
);
