import { drizzle } from 'drizzle-orm/node-postgres';
import { createAuth } from '../auth/auth.js';
import { createDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import * as schema from '../db/schema/index.js';
import { loadEnv } from '../env.js';
import { createLogger } from '../logger.js';
import { createSecretBox } from '../services/crypto.js';
import { DEFAULT_DEMO_PASSWORD, resetDemo, seedDemo } from './seed.js';

const command = process.argv[2];
if (command !== 'seed' && command !== 'reset') {
  console.error('Usage: demo-cli <seed|reset>');
  process.exit(1);
}

const env = loadEnv();
const logger = createLogger({ ...env, LOG_LEVEL: 'warn' });
const database = createDb(env.DATABASE_URL, logger);

try {
  await runMigrations(database);
  const db = drizzle({ client: database.pool, schema });
  if (command === 'reset') {
    await resetDemo({ db });
    console.log('Demo businesses removed.');
  } else {
    if (!env.TOKEN_ENCRYPTION_KEY) throw new Error('TOKEN_ENCRYPTION_KEY must be set');
    const password = process.env.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD;
    const logins = await seedDemo({
      auth: createAuth(db, env),
      db,
      box: createSecretBox(env.TOKEN_ENCRYPTION_KEY),
      password,
    });
    console.log('Demo ready. Everyone signs in with the password in DEMO_PASSWORD (see README).');
    for (const l of logins)
      console.log(`  ${l.business.padEnd(22)} ${l.role.padEnd(8)} ${l.email}`);
  }
} finally {
  await database.close();
}
