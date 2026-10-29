import { createDb } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { TEST_DATABASE_URL } from './constants.js';

/** Rebuilds the test database from the migrations once per run, so they're exercised too. */
export default async function setup() {
  const database = createDb(TEST_DATABASE_URL, console);
  try {
    await database.pool.query('drop schema if exists public cascade');
    await database.pool.query('drop schema if exists drizzle cascade');
    await database.pool.query('create schema public');
    await runMigrations(database);
  } catch (err) {
    throw new Error(
      `Could not prepare the test database at ${TEST_DATABASE_URL}. Is Postgres running (pnpm db:up)?`,
      { cause: err },
    );
  } finally {
    await database.close();
  }
}
