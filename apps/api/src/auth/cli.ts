// Config for the Better Auth CLI only (`pnpm --filter @leadgen/api auth:generate`).
// It inspects plugins/options to emit the Drizzle schema; it never connects to a database.
import { drizzle } from 'drizzle-orm/node-postgres';
import { createAuth, type AppDb } from './auth.js';

export const auth = createAuth(drizzle.mock() as unknown as AppDb, {
  BETTER_AUTH_SECRET: 'cli-only-secret-cli-only-secret-cli',
  BETTER_AUTH_URL: 'http://localhost:3000',
  WEB_ORIGIN: 'http://localhost:5173',
});
