import type { Answers } from '@leadgen/shared';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';
import { campaigns, campaignVersions } from './campaigns.js';
import { whatsappNumbers } from './whatsapp.js';

export const LEAD_STATUSES = [
  'new',
  'in_conversation',
  'completed',
  'needs_human',
  'dropped',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** The version the lead started on; the conversation never switches versions. */
    campaignVersionId: uuid('campaign_version_id')
      .notNull()
      .references(() => campaignVersions.id),
    name: text('name').notNull(),
    /** Normalized: digits only, with country code. */
    phone: text('phone').notNull(),
    source: text('source').notNull().default('link'),
    utm: jsonb('utm').$type<Record<string, string>>().notNull().default({}),
    answers: jsonb('answers').$type<Answers>().notNull().default({}),
    currentQuestionId: text('current_question_id'),
    /** Where the lead is inside a multi-step question (picking a day, a time, ...). */
    flowState: jsonb('flow_state').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status', { enum: LEAD_STATUSES }).notNull().default('new'),
    /** True while a person has taken over the chat. */
    botPaused: boolean('bot_paused').notNull().default(false),
    /** Start of the 24h free-form window. */
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('leads_org_phone_idx').on(t.organizationId, t.phone, t.updatedAt),
    index('leads_campaign_idx').on(t.campaignId, t.createdAt),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Null for messages from numbers we have no lead for. */
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    whatsappNumberId: uuid('whatsapp_number_id').references(() => whatsappNumbers.id, {
      onDelete: 'set null',
    }),
    /** Meta's message id; unique so a redelivered webhook is processed once. */
    waMessageId: text('wa_message_id'),
    /** The customer's phone (digits), kept even when no lead matched. */
    phone: text('phone').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    type: text('type').notNull(),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    deliveryStatus: text('delivery_status'),
    sentByUserId: text('sent_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    channel: text('channel', { enum: ['whatsapp', 'simulator'] })
      .notNull()
      .default('whatsapp'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_wa_message_id_uq').on(t.waMessageId),
    index('messages_lead_idx').on(t.leadId, t.createdAt),
  ],
);

export const LEAD_EVENT_TYPES = [
  'submitted',
  'first_reply',
  'answered',
  'completed',
  'booked',
  'handoff',
  'dropped',
] as const;
export type LeadEventType = (typeof LEAD_EVENT_TYPES)[number];

/** One row per funnel step; drives the funnel and drop-off views. */
export const leadEvents = pgTable(
  'lead_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    type: text('type', { enum: LEAD_EVENT_TYPES }).notNull(),
    questionId: text('question_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lead_events_campaign_idx').on(t.campaignId, t.type, t.at)],
);
