import type { CampaignConfigInput } from '@leadgen/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './db/schema/index.js';
import {
  createBusinessWithOwner,
  createTestContext,
  type TestClient,
  type TestContext,
} from './test/helpers.js';

const PHONE_NUMBER_ID = '5000000000002';

const survey: CampaignConfigInput = {
  questions: [
    {
      id: 'budget',
      key: 'budget',
      type: 'single_choice',
      channel: 'whatsapp',
      prompt: 'Budget?',
      options: [
        { id: 'low', label: 'Low' },
        { id: 'high', label: 'High' },
      ],
    },
  ],
  settings: { goal: 'lead', confirmation: 'Thanks {{name}}.' },
};

let ctx: TestContext;
let owner: TestClient;
let other: TestClient;
let campaignId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  ({ owner } = await createBusinessWithOwner(ctx, 'Acme Co', 'owner@acme.test'));
  ({ owner: other } = await createBusinessWithOwner(ctx, 'Other Co', 'owner@other.test'));
  const number = await owner.request('/api/whatsapp-numbers', {
    json: {
      phoneNumberId: PHONE_NUMBER_ID,
      displayNumber: '+91 99999 55555',
      accessToken: 'EAAG-this-is-a-long-fake-access-token-1234567890',
    },
  });
  const campaign = await owner.request('/api/campaigns', {
    json: {
      name: 'Survey',
      slug: 'survey',
      whatsappNumberId: number.body.number.id,
      draft: survey,
    },
  });
  campaignId = campaign.body.campaign.id;
});

afterAll(() => ctx.close());

describe('simulator', () => {
  it('refuses a campaign that is not published', async () => {
    const res = await owner.request('/api/simulator/start', { json: { campaignId } });
    expect(res.status).toBe(409);
  });

  it('plays a customer through the real bot without touching Meta', async () => {
    await owner.request(`/api/campaigns/${campaignId}/publish`, { method: 'POST', json: {} });
    ctx.graph.reset();

    const start = await owner.request('/api/simulator/start', {
      json: { campaignId, name: 'Pat' },
    });
    expect(start.status).toBe(201);
    const leadId: string = start.body.leadId;

    expect(
      (await owner.request(`/api/simulator/${leadId}/reply`, { json: { text: 'Hi' } })).status,
    ).toBe(200);
    const asked = await owner.request(`/api/leads/${leadId}`);
    expect(asked.body.lead.phone.startsWith('0000')).toBe(true);
    const question = asked.body.messages.at(-1);
    expect(question.direction).toBe('out');
    expect(question.body.body).toContain('Budget?');

    await owner.request(`/api/simulator/${leadId}/reply`, {
      json: { replyId: 'budget:high', title: 'High' },
    });
    const done = await owner.request(`/api/leads/${leadId}`);
    expect(done.body.lead.status).toBe('completed');
    expect(done.body.messages.at(-1).body.body).toBe('Thanks Pat.');

    // Nothing left for Meta, and every message is marked as simulated.
    expect(ctx.graph.sent).toEqual([]);
    const rows = await ctx.db
      .select({ channel: schema.messages.channel })
      .from(schema.messages)
      .where(eq(schema.messages.leadId, leadId));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(new Set(rows.map((r) => r.channel))).toEqual(new Set(['simulator']));
  });

  it('fills in the form answers a real customer would have given', async () => {
    const form = await owner.request('/api/campaigns', {
      json: {
        name: 'Formy',
        slug: 'formy',
        whatsappNumberId: (await owner.request('/api/whatsapp-numbers')).body.numbers[0].id,
        draft: {
          questions: [
            {
              id: 'topic',
              key: 'topic',
              type: 'single_choice',
              channel: 'form',
              prompt: 'Topic?',
              options: [
                { id: 'a', label: 'Alpha' },
                { id: 'b', label: 'Beta' },
              ],
            },
            {
              id: 'note',
              key: 'note',
              type: 'short_text',
              channel: 'whatsapp',
              prompt: 'About {{answers.topic}}?',
            },
          ],
          settings: { goal: 'lead', confirmation: 'Thanks.' },
        },
      },
    });
    await owner.request(`/api/campaigns/${form.body.campaign.id}/publish`, {
      method: 'POST',
      json: {},
    });
    const start = await owner.request('/api/simulator/start', {
      json: { campaignId: form.body.campaign.id },
    });
    const leadId: string = start.body.leadId;
    await owner.request(`/api/simulator/${leadId}/reply`, { json: { text: 'Hi' } });
    const chat = await owner.request(`/api/leads/${leadId}`);
    expect(chat.body.messages.at(-1).body.body).toBe('About Alpha?');
  });

  it('only plays made-up customers, and only in your own business', async () => {
    const start = await owner.request('/api/simulator/start', { json: { campaignId } });
    const leadId: string = start.body.leadId;
    const peek = await other.request(`/api/simulator/${leadId}/reply`, { json: { text: 'Hi' } });
    expect(peek.status).toBe(404);
    const foreign = await other.request('/api/simulator/start', { json: { campaignId } });
    expect(foreign.status).toBe(409);

    // A real customer's lead can't be driven from the simulator.
    await fetch(`${ctx.baseUrl}/f/survey`, {
      method: 'POST',
      body: new URLSearchParams({ name: 'Real', phone: '919876500111', consent: 'yes' }),
    });
    await ctx.settle();
    const [real] = await ctx.db
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(eq(schema.leads.phone, '919876500111'));
    const forged = await owner.request(`/api/simulator/${real!.id}/reply`, { json: { text: 'x' } });
    expect(forged.status).toBe(404);
  });
});
