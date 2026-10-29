import { drizzle } from 'drizzle-orm/node-postgres';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import * as schema from './db/schema/index.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createConversationService } from './services/conversations.js';
import { createSecretBox } from './services/crypto.js';
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
const graph = env.WHATSAPP_DRY_RUN
  ? createDryRunGraphClient((line) => logger.info(line))
  : createGraphClient({ version: env.GRAPH_API_VERSION });
const conversations = secretBox
  ? createConversationService({
      db,
      box: secretBox,
      graph,
      logger,
      templateMode: env.WHATSAPP_TEMPLATE_MODE,
    })
  : undefined;
if (!conversations) logger.warn('TOKEN_ENCRYPTION_KEY is not set: WhatsApp is disabled');
if (env.WHATSAPP_DRY_RUN) logger.warn('WHATSAPP_DRY_RUN is on: no messages are sent to Meta');

const app = createApp({
  logger,
  db,
  auth,
  pingDb: database.ping,
  secretBox,
  conversations,
  metaVerifyToken: env.META_VERIFY_TOKEN,
  metaAppSecret: env.META_APP_SECRET,
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
    database.close().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
