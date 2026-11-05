import { PgBoss } from 'pg-boss';
import type { AppDb } from '../auth/auth.js';
import type { Logger } from '../logger.js';
import type { ReminderJob, ReminderService, Scheduler } from '../services/reminders.js';
import { dropStaleLeads } from '../services/staleLeads.js';

export const REMINDER_QUEUE = 'booking-reminder';
export const STALE_QUEUE = 'stale-leads';

/** Starts pg-boss: delayed reminder jobs and the recurring sweep for abandoned leads. */
export async function startJobs({
  connectionString,
  schema = 'pgboss',
  db,
  reminders,
  logger,
}: {
  connectionString: string;
  schema?: string;
  db: AppDb;
  reminders: Pick<ReminderService, 'send'>;
  logger: Logger;
}) {
  const boss = new PgBoss({ connectionString, schema });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();
  await boss.createQueue(REMINDER_QUEUE);
  await boss.createQueue(STALE_QUEUE);

  await boss.work<ReminderJob>(REMINDER_QUEUE, async (jobs) => {
    for (const job of jobs) {
      // Throwing hands the job back to pg-boss for a retry.
      const outcome = await reminders.send(job.data);
      logger.info({ bookingId: job.data.bookingId, outcome }, 'reminder job done');
    }
  });

  await boss.schedule(STALE_QUEUE, '*/15 * * * *');
  await boss.work(STALE_QUEUE, async () => {
    const dropped = await dropStaleLeads(db);
    if (dropped > 0) logger.info({ dropped }, 'dropped stale leads');
  });

  const scheduler: Scheduler = {
    async scheduleReminder(job, at) {
      // One job per booking, offset and start, so confirming twice doesn't remind twice.
      await boss.send(REMINDER_QUEUE, job, {
        startAfter: at,
        singletonKey: `${job.bookingId}:${job.offset}:${job.startsAt}`,
        retryLimit: 3,
        retryDelay: 60,
      });
    },
  };

  return { scheduler, stop: () => boss.stop({ graceful: true, timeout: 5000 }) };
}
