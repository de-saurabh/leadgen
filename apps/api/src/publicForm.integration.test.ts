import { clinicExample } from '@leadgen/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './db/schema/index.js';
import { createBusinessWithOwner, createTestContext, type TestContext } from './test/helpers.js';

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof createBusinessWithOwner>>['owner'];
const created: string[] = [];

const GOOD = {
  name: 'Asha Rao',
  phone: '98765 43210',
  consent: 'yes',
  q_reason: 'skin',
};

function post(slug: string, fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
  }
  return fetch(`${ctx.baseUrl}/f/${slug}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

const leads = () => ctx.db.select().from(schema.leads).orderBy(schema.leads.createdAt);

beforeAll(async () => {
  ctx = await createTestContext({ onLeadCreated: (id) => created.push(id) });
  ({ owner } = await createBusinessWithOwner(ctx, 'Alpha Clinic', 'owner@alpha.test'));
  const number = await owner.request('/api/whatsapp-numbers', {
    json: {
      phoneNumberId: '1000000000001',
      displayNumber: '+91 99999 11111',
      accessToken: 'EAAG-this-is-a-long-fake-access-token-1234567890',
    },
  });
  const campaign = await owner.request('/api/campaigns', {
    json: {
      name: 'Book a visit',
      slug: 'visit',
      whatsappNumberId: number.body.number.id,
      draft: clinicExample,
    },
  });
  await owner.request(`/api/campaigns/${campaign.body.campaign.id}/publish`, {
    method: 'POST',
    json: {},
  });
  await owner.request('/api/campaigns', {
    json: { name: 'Unpublished', slug: 'draft-only', draft: clinicExample },
  });
});

afterAll(() => ctx.close());

describe('GET /f/:slug', () => {
  it('renders only the form questions of the published version', async () => {
    const res = await fetch(`${ctx.baseUrl}/f/visit?src=qr&utm_source=poster`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('What do you need help with?');
    expect(html).toContain('name="consent"');
    expect(html).not.toContain('first visit'); // a WhatsApp question
    expect(html).toContain('name="src" value="qr"');
    expect(html).toContain('name="utm_source" value="poster"');
  });

  it('404s for unknown and unpublished campaigns', async () => {
    expect((await fetch(`${ctx.baseUrl}/f/nope`)).status).toBe(404);
    expect((await fetch(`${ctx.baseUrl}/f/draft-only`)).status).toBe(404);
  });
});

describe('POST /f/:slug', () => {
  it('saves a lead pinned to the version, with normalized phone, answers and source', async () => {
    const res = await post('visit', { ...GOOD, src: 'qr', utm_source: 'poster' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Continue on WhatsApp');
    expect(html).toContain('https://wa.me/919999911111');

    const [lead] = await leads();
    expect(lead).toMatchObject({
      name: 'Asha Rao',
      phone: '919876543210',
      source: 'qr',
      utm: { utm_source: 'poster' },
      answers: { reason: 'skin' },
      status: 'new',
    });
    const [version] = await ctx.db.select().from(schema.campaignVersions);
    expect(lead!.campaignVersionId).toBe(version!.id);
    expect(created).toEqual([lead!.id]);

    const events = await ctx.db
      .select()
      .from(schema.leadEvents)
      .where(eq(schema.leadEvents.leadId, lead!.id));
    expect(events.map((e) => e.type)).toEqual(['submitted']);
  });

  it('re-renders with errors and keeps what was typed', async () => {
    const before = (await leads()).length;
    const res = await post('visit', { name: '', phone: '123', q_reason: 'bogus' });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain('Please tell us your name.');
    expect(html).toContain('Enter a valid WhatsApp number');
    expect(html).toContain('Pick one of the choices.');
    expect(html).toContain('We need your OK');
    expect(html).toContain('value="123"');
    expect((await leads()).length).toBe(before);
  });

  it('escapes what people type', async () => {
    const res = await post('visit', { name: '"><script>alert(1)</script>', phone: '1' });
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('ignores an unknown source value', async () => {
    await post('visit', { ...GOOD, phone: '9000000001', src: 'carrier-pigeon' });
    const all = await leads();
    expect(all.at(-1)!.source).toBe('link');
  });

  it('drops the earlier unfinished lead when the same person submits again', async () => {
    await post('visit', { ...GOOD, phone: '9000000002' });
    await post('visit', { ...GOOD, phone: '+91 90000 00002' });
    const mine = (await leads()).filter((l) => l.phone === '919000000002');
    expect(mine.map((l) => l.status)).toEqual(['dropped', 'new']);
    const dropped = await ctx.db
      .select()
      .from(schema.leadEvents)
      .where(eq(schema.leadEvents.leadId, mine[0]!.id));
    expect(dropped.map((e) => e.type)).toEqual(['submitted', 'dropped']);
  });

  it('quietly discards honeypot submissions', async () => {
    const before = (await leads()).length;
    const res = await post('visit', {
      ...GOOD,
      phone: '9000000003',
      website: 'http://spam.example',
    });
    expect(res.status).toBe(200);
    expect((await leads()).length).toBe(before);
  });

  it('404s on an unpublished campaign', async () => {
    expect((await post('draft-only', GOOD)).status).toBe(404);
  });
});
