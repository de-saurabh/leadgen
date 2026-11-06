import { drizzle } from 'drizzle-orm/node-postgres';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import * as schema from './db/schema/index.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { startJobs } from './jobs/jobs.js';
import { createEventBus } from './services/events.js';
import { createConversationService } from './services/conversations.js';
import { createDelivery } from './services/delivery.js';
import { createReminderService, noopScheduler, type Scheduler } from './services/reminders.js';
import { createSecretBox } from './services/crypto.js';
import { withSimulator } from './whatsapp/simulator.js';
import { createDryRunGraphClient, createGraphClient } from './whatsapp/graph.js';
import { ensurePlatformAdmin } from './services/platformAdmin.js';

const env = loadEnv();
const logger = createLogger(env);
const database = createDb(env.DATABASE_URL, logger);

await runMigrations(database);
logger.info('database migrations up to date');

const db = drizzle({ client: database.pool, schema });
const auth = createAuth(db, env);

if (env.PLATFORM_ADMIN_EMAIL && env.PLATFORM_ADMIN_PASSWORD) {
  const { created } = await ensurePlatformAdmin(
    { auth, db },
    { email: env.PLATFORM_ADMIN_EMAIL, password: env.PLATFORM_ADMIN_PASSWORD },
  );
  logger.info(
    `platform admin ${env.PLATFORM_ADMIN_EMAIL} ${created ? 'created' : 'already present'}`,
  );
}

const secretBox = env.TOKEN_ENCRYPTION_KEY ? createSecretBox(env.TOKEN_ENCRYPTION_KEY) : undefined;
const graph = withSimulator(
  env.WHATSAPP_DRY_RUN
    ? createDryRunGraphClient((line) => logger.info(line))
    : createGraphClient({ version: env.GRAPH_API_VERSION }),
);
// Reminders need a scheduler and the scheduler needs the reminder service, so the
// service gets a late-bound one that is swapped for pg-boss once that has started.
let scheduler: Scheduler = noopScheduler;
const reminders = secretBox
  ? createReminderService({
      db,
      deliver: createDelivery({ box: secretBox, graph }),
      logger,
      templateMode: env.WHATSAPP_TEMPLATE_MODE,
      scheduler: { scheduleReminder: (job, at) => scheduler.scheduleReminder(job, at) },
    })
  : undefined;
const bus = createEventBus();
const conversations = secretBox
  ? createConversationService({
      bus,
      db,
      box: secretBox,
      graph,
      logger,
      templateMode: env.WHATSAPP_TEMPLATE_MODE,
      scheduleReminders: reminders?.scheduleFor,
    })
  : undefined;
if (!conversations) logger.warn('TOKEN_ENCRYPTION_KEY is not set: WhatsApp is disabled');
if (env.WHATSAPP_DRY_RUN) logger.warn('WHATSAPP_DRY_RUN is on: no messages are sent to Meta');

const jobs = await startJobs({
  connectionString: env.DATABASE_URL,
  db,
  reminders: reminders ?? { send: async () => 'skipped' },
  logger,
});
scheduler = jobs.scheduler;
logger.info('background jobs started');

const app = createApp({
  logger,
  db,
  auth,
  pingDb: database.ping,
  secretBox,
  conversations,
  bus,
  metaVerifyToken: env.META_VERIFY_TOKEN,
  metaAppSecret: env.META_APP_SECRET,
  publicConfig: { publicUrl: env.BETTER_AUTH_URL, templateMode: env.WHATSAPP_TEMPLATE_MODE },
  onLeadCreated: (leadId) => {
    conversations
      ?.sendOpeningTemplate(leadId)
      .catch((err) => logger.error({ err, leadId }, 'could not send the opening template'));
  },
  webDistDir: env.WEB_DIST_DIR,
});

const server = app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    jobs
      .stop()
      .catch((err) => logger.error({ err }, 'could not stop background jobs'))
      .finally(() => database.close().finally(() => process.exit(0)));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
