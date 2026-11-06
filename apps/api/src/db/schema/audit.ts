import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** What the platform admin did inside a business, for accountability. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The platform admin who acted. */
    actorUserId: text('actor_user_id').notNull(),
    /** The person they were viewing as, when there is one. */
    targetUserId: text('target_user_id'),
    organizationId: text('organization_id'),
    action: text('action', {
      enum: ['impersonation_started', 'impersonation_stopped', 'write_blocked'],
    }).notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_at_idx').on(t.at)],
);
