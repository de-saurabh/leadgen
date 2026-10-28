import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Logger } from '../logger.js';

export function createDb(databaseUrl: string, logger: Logger) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  // Idle clients emit 'error' when the server drops them (restart, failover). Unhandled,
  // that would crash the process; the pool discards the client and reconnects on next use.
  pool.on('error', (err) => logger.error({ err }, 'idle database client error'));
  const db = drizzle({ client: pool });

  return {
    db,
    async ping() {
      await db.execute(sql`select 1`);
    },
    close: () => pool.end(),
  };
}

export type Database = ReturnType<typeof createDb>;
