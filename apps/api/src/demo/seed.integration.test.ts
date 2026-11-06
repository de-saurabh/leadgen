import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../db/schema/index.js';
import { createSecretBox } from '../services/crypto.js';
import { TEST_ENV } from '../test/constants.js';
import { createTestContext, type TestContext } from '../test/helpers.js';
import { DEMO_DOMAIN, resetDemo, seedDemo } from './seed.js';

let ctx: TestContext;
const PASSWORD = 'demo-test-password';

const deps = () => ({
  auth: ctx.auth,
  db: ctx.db,
  box: createSecretBox(TEST_ENV.TOKEN_ENCRYPTION_KEY),
  password: PASSWORD,
  now: new Date('2026-11-06T10:00:00Z'),
});

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(() => ctx.close());

describe('demo seed', () => {
  it('builds three working businesses with a few weeks of history', async () => {
    const logins = await seedDemo(deps());
    expect(logins.length).toBe(7);

    const owner = ctx.client();
    const signedIn = await owner.signIn(`citycare@${DEMO_DOMAIN}`, PASSWORD);
    expect(signedIn.status).toBe(200);

    const leads = await owner.request('/api/leads');
    expect(leads.body.leads.length).toBeGreaterThan(40);
    const stats = await owner.request(
      '/api/analytics?from=2026-10-01T00:00:00Z&to=2026-12-01T00:00:00Z',
    );
    expect(stats.body.totals.leads).toBeGreaterThan(40);
    expect(stats.body.totals.booked).toBeGreaterThan(5);
    expect(stats.body.bySource.length).toBeGreaterThan(1);

    const bookings = await owner.request(
      '/api/bookings?from=2026-10-01T00:00:00Z&to=2026-12-31T00:00:00Z',
    );
    expect(bookings.status).toBe(200);
    expect(bookings.body.bookings.length).toBeGreaterThan(5);

    // The campaign is live, so the public form works.
    const form = await fetch(`${ctx.baseUrl}/f/demo-book-a-doctor`);
    expect(form.status).toBe(200);

    // A doctor sees only their own patients' bookings.
    const doctor = ctx.client();
    await doctor.signIn(`dr.rao@${DEMO_DOMAIN}`, PASSWORD);
    const mine = await doctor.request(
      '/api/bookings?from=2026-10-01T00:00:00Z&to=2026-12-31T00:00:00Z',
    );
    expect(mine.body.bookings.length).toBeLessThan(bookings.body.bookings.length);
  });

  it('can be run again and then removed without touching anything else', async () => {
    await seedDemo(deps());
    const orgs = await ctx.db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, 'demo-neon-pub'));
    expect(orgs).toHaveLength(1);

    await resetDemo({ db: ctx.db });
    const [left] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(schema.leads);
    expect(left!.n).toBe(0);
    const people = await ctx.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(inArray(schema.user.email, [`citycare@${DEMO_DOMAIN}`, `dr.rao@${DEMO_DOMAIN}`]));
    expect(people).toEqual([]);
  });
});
