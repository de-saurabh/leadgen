import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDb } from '../db/client.js';
import type { ReminderJob } from '../services/reminders.js';
import { TEST_DATABASE_URL } from '../test/constants.js';
import { startJobs } from './jobs.js';

describe('background jobs', () => {
  const database = createDb(TEST_DATABASE_URL, console);
  const send = vi.fn(async (_job: ReminderJob) => 'sent' as const);
  let jobs: Awaited<ReturnType<typeof startJobs>>;

  beforeAll(async () => {
    jobs = await startJobs({
      connectionString: TEST_DATABASE_URL,
      schema: 'pgboss_test',
      db: database.db,
      reminders: { send },
      logger: pino({ level: 'silent' }),
    });
  });

  afterAll(async () => {
    await jobs.stop();
    await database.close();
  });

  it('delivers a reminder job at its time, once', async () => {
    const job: ReminderJob = {
      // Unique per run: pg-boss keeps its jobs between runs of the test database.
      bookingId: randomUUID(),
      startsAt: '2030-01-01T10:00:00.000Z',
      offset: 180,
    };
    const at = new Date(Date.now() + 1500);
    await jobs.scheduler.scheduleReminder(job, at);
    await jobs.scheduler.scheduleReminder(job, at); // same booking and offset: one job

    const sentFor = () => send.mock.calls.filter(([j]) => j.bookingId === job.bookingId);
    expect(sentFor()).toHaveLength(0);
    await vi.waitFor(() => expect(sentFor()).toHaveLength(1), {
      timeout: 15_000,
      interval: 250,
    });
    expect(sentFor()[0]![0]).toEqual(job);
    await new Promise((r) => setTimeout(r, 1500));
    expect(sentFor()).toHaveLength(1);
  }, 25_000);
});
