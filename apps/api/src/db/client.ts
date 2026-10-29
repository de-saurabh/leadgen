import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Logger } from '../logger.js';
import * as schema from './schema/index.js';

export function createDb(databaseUrl: string, logger: Pick<Logger, 'error'>) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // Idle clients emit 'error' when the server drops them (restart, failover). Unhandled,
  // that would crash the process; the pool discards the client and reconnects on next use.
  pool.on('error', (err) => logger.error({ err }, 'idle database client error'));
  const db = drizzle({ client: pool, schema });

  return {
    db,
    pool,
    async ping() {
      await db.execute(sql`select 1`);
    },
    close: () => pool.end(),
  };
}

export type Database = ReturnType<typeof createDb>;
