import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization } from './auth.js';

/** A business's own WhatsApp Business number. Incoming webhooks are routed by `phoneNumberId`. */
export const whatsappNumbers = pgTable('whatsapp_numbers', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  /** Meta's id for the number (not the phone number itself). */
  phoneNumberId: text('phone_number_id').notNull().unique(),
  wabaId: text('waba_id'),
  /** The number customers see, digits only, used for wa.me links. */
  displayNumber: text('display_number').notNull(),
  /** AES-256-GCM encrypted access token (see services/crypto). */
  accessTokenEnc: text('access_token_enc').notNull(),
  status: text('status', { enum: ['active', 'disabled'] })
    .notNull()
    .default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
