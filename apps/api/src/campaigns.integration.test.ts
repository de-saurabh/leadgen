import { clinicExample, leadExample, type CampaignConfigInput } from '@leadgen/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './db/schema/index.js';
import { createBusinessWithOwner, createTestContext, type TestContext } from './test/helpers.js';

let ctx: TestContext;
let a: Awaited<ReturnType<typeof createBusinessWithOwner>>;
let b: Awaited<ReturnType<typeof createBusinessWithOwner>>;
let numberId: string;

const TOKEN = 'EAAG-this-is-a-long-fake-access-token-1234567890';

beforeAll(async () => {
  ctx = await createTestContext();
  a = await createBusinessWithOwner(ctx, 'Alpha Clinic', 'owner@alpha.test');
  b = await createBusinessWithOwner(ctx, 'Beta Cafe', 'owner@beta.test');
  const res = await a.owner.request('/api/whatsapp-numbers', {
    json: { phoneNumberId: '1000000000001', displayNumber: '+91 98765 43210', accessToken: TOKEN },
  });
  expect(res.status).toBe(201);
  numberId = res.body.number.id;
});

afterAll(() => ctx.close());

describe('whatsapp numbers', () => {
  it('stores the token encrypted and never returns it', async () => {
    const list = await a.owner.request('/api/whatsapp-numbers');
    expect(list.body.numbers).toHaveLength(1);
    expect(list.body.numbers[0]).toMatchObject({ displayNumber: '919876543210' });
    expect(JSON.stringify(list.body)).not.toContain(TOKEN);
    expect(JSON.stringify(list.body)).not.toContain('accessToken');

    const [row] = await ctx.db.select().from(schema.whatsappNumbers);
    expect(row!.accessTokenEnc).not.toContain(TOKEN);
    expect(row!.accessTokenEnc.startsWith('v1.')).toBe(true);
  });

  it('refuses a number that is already connected, even to another business', async () => {
    const res = await b.owner.request('/api/whatsapp-numbers', {
      json: { phoneNumberId: '1000000000001', displayNumber: '9100000000', accessToken: TOKEN },
    });
    expect(res.status).toBe(409);
  });

  it('lets the owner reconnect their own number to replace an expired token', async () => {
    const [before] = await ctx.db.select().from(schema.whatsappNumbers);
    const fresh = 'EAAG-a-brand-new-and-long-fake-access-token-0987654321';
    const res = await a.owner.request('/api/whatsapp-numbers', {
      json: { phoneNumberId: '1000000000001', displayNumber: '919876543210', accessToken: fresh },
    });
    expect(res.status).toBe(201);
    expect(res.body.number.id).toBe(numberId);
    expect(JSON.stringify(res.body)).not.toContain(fresh);
    const rows = await ctx.db.select().from(schema.whatsappNumbers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.accessTokenEnc).not.toBe(before!.accessTokenEnc);
  });

  it('subscribes the app to the WhatsApp account, and says so when Meta refuses', async () => {
    const body = {
      phoneNumberId: '1000000000001',
      wabaId: '777000111',
      displayNumber: '919876543210',
      accessToken: 'EAAG-this-is-a-long-fake-access-token-1234567890',
    };
    ctx.graph.reset();
    const ok = await a.owner.request('/api/whatsapp-numbers', { json: body });
    expect(ok.status).toBe(201);
    expect(ok.body.warning).toBeUndefined();
    expect(ctx.graph.subscribed).toEqual(['777000111']);

    ctx.graph.failSubscribe = true;
    const refused = await a.owner.request('/api/whatsapp-numbers', { json: body });
    expect(refused.status).toBe(201);
    expect(refused.body.warning).toContain('subscribe');
    ctx.graph.reset();
  });

  it('keeps numbers private to their business', async () => {
    expect((await b.owner.request('/api/whatsapp-numbers')).body.numbers).toEqual([]);
    const del = await b.owner.request(`/api/whatsapp-numbers/${numberId}`, { method: 'DELETE' });
    expect(del.status).toBe(404);
  });

  it('validates the request and needs a session', async () => {
    const bad = await a.owner.request('/api/whatsapp-numbers', {
      json: { phoneNumberId: 'abc', displayNumber: '1', accessToken: 'x' },
    });
    expect(bad.status).toBe(400);
    expect((await ctx.client().request('/api/whatsapp-numbers')).status).toBe(401);
  });
});

describe('campaigns', () => {
  let campaignId: string;
  const publish = (client: typeof a.owner, id: string) =>
    client.request(`/api/campaigns/${id}/publish`, { method: 'POST', json: {} });

  it('creates a draft with a derived slug and a number', async () => {
    const res = await a.owner.request('/api/campaigns', {
      json: { name: 'Book a visit', whatsappNumberId: numberId, draft: clinicExample },
    });
    expect(res.status).toBe(201);
    expect(res.body.campaign).toMatchObject({ slug: 'book-a-visit', status: 'draft' });
    campaignId = res.body.campaign.id;
  });

  it('adds a suffix when the derived slug is taken, and rejects a taken explicit slug', async () => {
    const auto = await b.owner.request('/api/campaigns', {
      json: { name: 'Book a visit', draft: leadExample },
    });
    expect(auto.body.campaign.slug).toBe('book-a-visit-2');
    const explicit = await b.owner.request('/api/campaigns', {
      json: { name: 'Other', slug: 'book-a-visit', draft: leadExample },
    });
    expect(explicit.status).toBe(409);
  });

  it('refuses to use another business number', async () => {
    const res = await b.owner.request('/api/campaigns', {
      json: { name: 'Borrowed', whatsappNumberId: numberId, draft: leadExample },
    });
    expect(res.status).toBe(404);
  });

  it('hides campaigns from other businesses', async () => {
    expect((await b.owner.request(`/api/campaigns/${campaignId}`)).status).toBe(404);
    expect((await publish(b.owner, campaignId)).status).toBe(404);
    const list = await b.owner.request('/api/campaigns');
    expect(list.body.campaigns.map((c: { id: string }) => c.id)).not.toContain(campaignId);
  });

  it('will not publish an invalid draft, and says why', async () => {
    const created = await a.owner.request('/api/campaigns', {
      json: {
        name: 'Broken',
        whatsappNumberId: numberId,
        draft: { questions: [], settings: { goal: 'booking', confirmation: 'ok' } },
      },
    });
    const res = await publish(a.owner, created.body.campaign.id);
    expect(res.status).toBe(422);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it('will not publish without a number', async () => {
    const created = await a.owner.request('/api/campaigns', {
      json: { name: 'No number', draft: leadExample },
    });
    const res = await publish(a.owner, created.body.campaign.id);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('no_number');
  });

  it('publishes versions that freeze the config while the draft keeps changing', async () => {
    const first = await publish(a.owner, campaignId);
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(1);

    const changed = JSON.parse(JSON.stringify(clinicExample)) as CampaignConfigInput;
    changed.settings.confirmation = 'Changed text';
    const patch = await a.owner.request(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      json: { draft: changed },
    });
    expect(patch.status).toBe(200);

    const second = await publish(a.owner, campaignId);
    expect(second.body.version).toBe(2);

    const versions = await ctx.db
      .select()
      .from(schema.campaignVersions)
      .where(eq(schema.campaignVersions.campaignId, campaignId))
      .orderBy(schema.campaignVersions.version);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0]!.config.settings.confirmation).not.toBe('Changed text');
    expect(versions[1]!.config.settings.confirmation).toBe('Changed text');

    const [campaign] = await ctx.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId));
    expect(campaign).toMatchObject({ status: 'published', publishedVersionId: versions[1]!.id });
  });

  it('reports whether the draft still matches what is live', async () => {
    await publish(a.owner, campaignId);
    const live = await a.owner.request(`/api/campaigns/${campaignId}`);
    expect(live.body.published).toMatchObject({ matchesDraft: true });

    const edited = JSON.parse(JSON.stringify(live.body.campaign.draft)) as CampaignConfigInput;
    edited.settings.nudge = 'Tap one of the buttons';
    await a.owner.request(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      json: { draft: edited },
    });
    const after = await a.owner.request(`/api/campaigns/${campaignId}`);
    expect(after.body.published).toMatchObject({ matchesDraft: false });

    const fresh = await a.owner.request('/api/campaigns', {
      json: { name: 'Never published', draft: leadExample },
    });
    const unpublished = await a.owner.request(`/api/campaigns/${fresh.body.campaign.id}`);
    expect(unpublished.body.published).toBeNull();
  });

  it('numbers versions correctly under concurrent publishes', async () => {
    const results = await Promise.all([1, 2, 3].map(() => publish(a.owner, campaignId)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.body.version)).size).toBe(3);
  });
});
