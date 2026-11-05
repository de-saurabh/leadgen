import { displayAnswers, renderPlaceholders } from '@leadgen/shared';
import { eq } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import { formatDay, formatTime } from '../bookings/time.js';
import * as schema from '../db/schema/index.js';
import { changeButtons } from '../engine/aftercare.js';
import type { Logger } from '../logger.js';
import type { SendableMessage } from '../whatsapp/graph.js';
import { windowOpen, type Deliver } from './delivery.js';

export interface ReminderJob {
  bookingId: string;
  /** The start the reminder was scheduled for; a moved booking no longer matches. */
  startsAt: string;
  /** Minutes before the start. */
  offset: number;
}

/** Schedules work for later. The pg-boss implementation lives in `jobs/`. */
export interface Scheduler {
  scheduleReminder(job: ReminderJob, at: Date): Promise<void>;
}

export const noopScheduler: Scheduler = { async scheduleReminder() {} };

const REMINDER_TEXT =
  'Reminder from {{business}}: {{booking.resource}} on {{booking.date}} at {{booking.time}}. Need to change it?';
const TEST_TEMPLATE = { name: 'hello_world', language: 'en_US' } as const;

export function createReminderService({
  db,
  deliver,
  logger,
  templateMode,
  scheduler,
  now = () => new Date(),
}: {
  db: AppDb;
  deliver: Deliver;
  logger: Logger;
  templateMode: 'test' | 'live';
  scheduler: Scheduler;
  now?: () => Date;
}) {
  async function load(bookingId: string) {
    const [row] = await db
      .select({
        booking: schema.bookings,
        lead: schema.leads,
        config: schema.campaignVersions.config,
        businessName: schema.organization.name,
        timeZone: schema.businessSettings.timezone,
        number: schema.whatsappNumbers,
        resourceName: schema.resources.name,
        eventName: schema.events.name,
      })
      .from(schema.bookings)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.bookings.leadId))
      .innerJoin(
        schema.campaignVersions,
        eq(schema.campaignVersions.id, schema.leads.campaignVersionId),
      )
      .innerJoin(schema.organization, eq(schema.organization.id, schema.bookings.organizationId))
      .innerJoin(
        schema.businessSettings,
        eq(schema.businessSettings.organizationId, schema.bookings.organizationId),
      )
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
      .innerJoin(
        schema.whatsappNumbers,
        eq(schema.whatsappNumbers.id, schema.campaigns.whatsappNumberId),
      )
      .leftJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
      .leftJoin(schema.events, eq(schema.events.id, schema.bookings.eventId))
      .where(eq(schema.bookings.id, bookingId));
    return row;
  }

  return {
    /** Queues a reminder for each of the campaign's offsets that is still in the future. */
    async scheduleFor(bookingId: string) {
      const row = await load(bookingId);
      if (!row || row.booking.status !== 'confirmed') return 0;
      let scheduled = 0;
      for (const offset of row.config.settings.reminderOffsets) {
        const at = new Date(row.booking.startsAt.getTime() - offset * 60_000);
        if (at <= now()) continue;
        await scheduler.scheduleReminder(
          { bookingId, startsAt: row.booking.startsAt.toISOString(), offset },
          at,
        );
        scheduled++;
      }
      return scheduled;
    },

    /** Sends one reminder, unless the booking was cancelled, moved, or has already started. */
    async send(job: ReminderJob): Promise<'sent' | 'skipped'> {
      const row = await load(job.bookingId);
      if (
        !row ||
        row.booking.status !== 'confirmed' ||
        row.booking.startsAt.toISOString() !== job.startsAt ||
        row.booking.startsAt <= now()
      ) {
        return 'skipped';
      }
      const { booking, lead, config } = row;
      const ctx = {
        name: lead.name,
        business: row.businessName,
        answers: displayAnswers(config.questions, lead.answers),
        booking: {
          date: formatDay(booking.startsAt, row.timeZone),
          time: formatTime(booking.startsAt, row.timeZone),
          resource: row.resourceName ?? row.eventName ?? '',
        },
      };

      let message: SendableMessage;
      if (windowOpen(lead, now())) {
        message = changeButtons(renderPlaceholders(REMINDER_TEXT, ctx));
      } else if (templateMode === 'test') {
        logger.warn(
          { bookingId: booking.id },
          'reminder is outside the 24h window: sending hello_world',
        );
        message = { kind: 'template', ...TEST_TEMPLATE };
      } else {
        const template = config.settings.reminderTemplate;
        if (!template) {
          logger.warn(
            { bookingId: booking.id },
            'no reminder template and the 24h window is closed',
          );
          return 'skipped';
        }
        message = {
          kind: 'template',
          name: template.name,
          language: template.language,
          params: template.params.map((p) => renderPlaceholders(p, ctx)),
        };
      }
      await deliver(db, row.number, lead, [message]);
      return 'sent';
    },
  };
}

export type ReminderService = ReturnType<typeof createReminderService>;
