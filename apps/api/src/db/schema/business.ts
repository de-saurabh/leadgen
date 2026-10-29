import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { organization } from './auth.js';

/** LeadGen-specific settings for a business (a Better Auth organization). One row per business. */
export const businessSettings = pgTable('business_settings', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  /** IANA timezone; all times are stored in UTC and shown in this zone. */
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  /** Prefix for bare local phone numbers, digits only (e.g. "91"). */
  defaultCountryCode: text('default_country_code').notNull().default('91'),
  /** Business-specific display names for the generic roles, e.g. { "manager": "Receptionist" }. */
  roleLabels: jsonb('role_labels')
    .$type<Partial<Record<'owner' | 'manager' | 'member', string>>>()
    .notNull()
    .default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
