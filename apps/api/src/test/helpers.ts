import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { createApp } from '../app.js';
import { createAuth } from '../auth/auth.js';
import { createDb } from '../db/client.js';
import { createConversationService } from '../services/conversations.js';
import { createSecretBox } from '../services/crypto.js';
import { ensurePlatformAdmin } from '../services/platformAdmin.js';
import type { GraphClient, SendTarget, SendableMessage } from '../whatsapp/graph.js';
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

/** Stands in for Meta: records what would be sent, and can be told to fail. */
export class FakeGraph implements GraphClient {
  sent: Array<{ to: string; phoneNumberId: string; message: SendableMessage }> = [];
  failNext = 0;
  private counter = 0;

  async send(target: SendTarget, to: string, message: SendableMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('simulated WhatsApp failure');
    }
    this.sent.push({ to, phoneNumberId: target.phoneNumberId, message });
    return { waMessageId: `wamid.out.${++this.counter}` };
  }

  reset() {
    this.sent = [];
    this.failNext = 0;
  }
}

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

export async function createTestContext(
  overrides: { pingDb?: () => Promise<void>; onLeadCreated?: (leadId: string) => void } = {},
) {
  const database = createDb(TEST_DATABASE_URL, console);
  const { db } = database;
  const auth = createAuth(db, TEST_ENV);

  await database.pool.query(
    `truncate ${TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`,
  );
  await ensurePlatformAdmin({ auth, db }, ADMIN);

  const graph = new FakeGraph();
  const box = createSecretBox(TEST_ENV.TOKEN_ENCRYPTION_KEY);
  const conversations = createConversationService({
    db,
    box,
    graph,
    logger: pino({ level: 'silent' }),
    templateMode: 'test',
  });
  const background: Promise<unknown>[] = [];

  const app = createApp({
    logger: pino({ level: 'silent' }),
    db,
    auth,
    pingDb: overrides.pingDb ?? database.ping,
    secretBox: box,
    conversations,
    metaVerifyToken: TEST_ENV.META_VERIFY_TOKEN,
    metaAppSecret: TEST_ENV.META_APP_SECRET,
    onLeadCreated:
      overrides.onLeadCreated ??
      ((leadId) => {
        background.push(conversations.sendOpeningTemplate(leadId).catch(() => undefined));
      }),
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    db,
    auth,
    baseUrl,
    graph,
    conversations,
    /** Waits for work the app started after responding (e.g. the opening template). */
    async settle() {
      await Promise.all(background.splice(0));
    },
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

/** Creates a business through the admin API and returns a signed-in client for its owner. */
export async function createBusinessWithOwner(
  ctx: TestContext,
  name: string,
  ownerEmail: string,
  overrides: { timezone?: string; defaultCountryCode?: string } = {},
) {
  const admin = await ctx.adminClient();
  const res = await admin.request('/api/admin/businesses', {
    json: { name, owner: { name: 'Owner', email: ownerEmail }, ...overrides },
  });
  if (res.status !== 201) throw new Error(`create business failed: ${res.status}`);
  const owner = ctx.client();
  const signedIn = await owner.signIn(ownerEmail, res.body.business.generatedOwnerPassword);
  if (signedIn.status !== 200) throw new Error(`owner sign-in failed: ${signedIn.status}`);
  return { id: res.body.business.id as string, slug: res.body.business.slug as string, owner };
}
