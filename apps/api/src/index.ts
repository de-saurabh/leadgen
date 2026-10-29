import { drizzle } from 'drizzle-orm/node-postgres';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import * as schema from './db/schema/index.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createSecretBox } from './services/crypto.js';
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

const app = createApp({
  logger,
  db,
  auth,
  pingDb: database.ping,
  secretBox: env.TOKEN_ENCRYPTION_KEY ? createSecretBox(env.TOKEN_ENCRYPTION_KEY) : undefined,
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
