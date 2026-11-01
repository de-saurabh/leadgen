import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth.js';
import { campaigns } from './campaigns.js';
import { leads } from './leads.js';

export const RESOURCE_KINDS = ['person', 'table', 'room', 'court', 'other'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Something a customer can book: a person, a table, a room, a court. */
export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: RESOURCE_KINDS }).notNull().default('person'),
    /** The staff member whose bookings these are (a member sees only their own). */
    memberUserId: text('member_user_id').references(() => user.id, { onDelete: 'set null' }),
    /** How many people or parties one slot holds. */
    capacity: integer('capacity').notNull().default(1),
    slotMinutes: integer('slot_minutes').notNull().default(30),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('resources_org_idx').on(t.organizationId)],
);

/** Weekly opening hours in the business's local time. Several rows per day are fine. */
export const resourceHours = pgTable(
  'resource_hours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    /** ISO weekday: 1 = Monday ... 7 = Sunday. */
    weekday: integer('weekday').notNull(),
    /** Minutes after local midnight. */
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
  },
  (t) => [index('resource_hours_resource_idx').on(t.resourceId)],
);

export const resourceTimeOff = pgTable(
  'resource_time_off',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
  },
  (t) => [index('resource_time_off_resource_idx').on(t.resourceId, t.startsAt)],
);

/** A one-off occasion with its own capacity: a DJ night, a Diwali dinner. */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_org_starts_idx').on(t.organizationId, t.startsAt)],
);

/** Which resources a campaign offers. */
export const campaignResources = pgTable(
  'campaign_resources',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.resourceId] })],
);

/** Which events a campaign offers. */
export const campaignEvents = pgTable(
  'campaign_events',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.eventId] })],
);

export const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'rejected',
  'no_show',
  'completed',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses that hold capacity. */
export const CAPACITY_STATUSES = ['pending', 'confirmed'] as const;

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    /** Exactly one of resourceId / eventId is set. */
    resourceId: uuid('resource_id').references(() => resources.id, { onDelete: 'restrict' }),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    partySize: integer('party_size').notNull().default(1),
    status: text('status', { enum: BOOKING_STATUSES }).notNull().default('confirmed'),
    /** The booking this one replaced when a customer rescheduled. */
    rescheduledFromId: uuid('rescheduled_from_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('bookings_resource_starts_idx').on(t.resourceId, t.startsAt),
    index('bookings_event_idx').on(t.eventId),
    index('bookings_org_starts_idx').on(t.organizationId, t.startsAt),
    index('bookings_lead_idx').on(t.leadId),
  ],
);
