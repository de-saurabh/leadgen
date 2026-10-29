import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const env = loadEnv();
const logger = createLogger(env);
const database = createDb(env.DATABASE_URL, logger);

try {
  await runMigrations(database);
  logger.info('migrations applied');
} finally {
  await database.close();
}
