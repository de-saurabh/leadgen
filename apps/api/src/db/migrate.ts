import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

// Same relative location from src/ (dev) and dist/ (build).
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(database: Database) {
  await migrate(database.db, { migrationsFolder: MIGRATIONS_FOLDER });
}
