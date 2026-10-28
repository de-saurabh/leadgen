import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { loadEnv } from './env.js';
import { createLogger } from './logger.js';

const env = loadEnv();
const logger = createLogger(env);
const database = createDb(env.DATABASE_URL, logger);

const app = createApp({ logger, pingDb: database.ping, webDistDir: env.WEB_DIST_DIR });

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
