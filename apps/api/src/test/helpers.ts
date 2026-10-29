import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { createApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { createDb } from '../db/client.js';
import { ensurePlatformAdmin } from '../services/platformAdmin.js';
import { ADMIN, TEST_DATABASE_URL, TEST_ENV } from './constants.js';

const TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
  'business_settings',
];

/** Minimal cookie-keeping HTTP client that behaves like the dashboard (same-origin via proxy). */
export class TestClient {
  private cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  async request(path: string, init: { method?: string; json?: unknown } = {}) {
    const headers: Record<string, string> = { origin: TEST_ENV.WEB_ORIGIN };
    if (this.cookies.size) {
      headers.cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (init.json !== undefined) headers['content-type'] = 'application/json';

    const res = await fetch(this.baseUrl + path, {
      method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : null,
      redirect: 'manual',
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    // Test responses are asserted field by field; a precise type per route would just be noise.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as Record<string, any> };
  }

  signIn(email: string, password: string) {
    return this.request('/api/auth/sign-in/email', { json: { email, password } });
  }
}

export async function createTestContext(overrides: { pingDb?: () => Promise<void> } = {}) {
  const database = createDb(TEST_DATABASE_URL, console);
  const { db } = database;
  const auth = createAuth(db, TEST_ENV);

  await database.pool.query(
    `truncate ${TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`,
  );
  await ensurePlatformAdmin({ auth, db }, ADMIN);

  const app = createApp({
    logger: pino({ level: 'silent' }),
    db,
    auth,
    pingDb: overrides.pingDb ?? database.ping,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    db,
    auth,
    baseUrl,
    client: () => new TestClient(baseUrl),
    async adminClient() {
      const client = new TestClient(baseUrl);
      const res = await client.signIn(ADMIN.email, ADMIN.password);
      if (res.status !== 200) throw new Error(`admin sign-in failed: ${res.status}`);
      return client;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.close();
    },
  };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
