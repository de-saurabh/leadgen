import type { CampaignConfigInput } from '@leadgen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChat } from './test/chat.js';
import {
  createBusinessWithOwner,
  createTestContext,
  type TestClient,
  type TestContext,
} from './test/helpers.js';

const PHONE_NUMBER_ID = '5000000000001';

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
    { id: 'when', key: 'when', type: 'date', channel: 'whatsapp', prompt: 'When?' },
  ],
  settings: { goal: 'lead', confirmation: 'Thanks {{name}}.' },
};

let ctx: TestContext;
let owner: TestClient;
let other: TestClient;
let campaignId: string;

const submit = async (phone: string, source: string) => {
  await fetch(`${ctx.baseUrl}/f/survey`, {
    method: 'POST',
    body: new URLSearchParams({
      name: `Lead ${phone.slice(-2)}`,
      phone,
      consent: 'yes',
      src: source,
    }),
  });
  await ctx.settle();
};

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
  await owner.request(`/api/campaigns/${campaignId}/publish`, { method: 'POST', json: {} });

  const chat = createChat(ctx, PHONE_NUMBER_ID);
  await submit('919876500101', 'link');
  await submit('919876500102', 'qr');
  await submit('919876500103', 'qr');
  await chat.say('919876500101', 'Hi');
  await chat.tap('919876500101', 'budget:high');
  await chat.say('919876500101', '1/2/2027');
  await chat.say('919876500102', 'Hi');
  await chat.tap('919876500102', 'budget:low');
  await chat.say('919876500103', 'human');
});

afterAll(() => ctx.close());

describe('analytics', () => {
  it('counts the funnel, sources and campaigns', async () => {
    const res = await owner.request('/api/analytics');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      leads: 3,
      replied: 3,
      completed: 1,
      booked: 0,
      handedOff: 1,
      dropped: 0,
    });
    const qr = res.body.bySource.find((s: { source: string }) => s.source === 'qr');
    expect(qr).toMatchObject({ leads: 2, replied: 2, completed: 0 });
    expect(res.body.bySource.find((s: { source: string }) => s.source === 'link')).toMatchObject({
      leads: 1,
      completed: 1,
    });
    expect(res.body.byCampaign).toHaveLength(1);
    expect(res.body.byCampaign[0]).toMatchObject({ name: 'Survey', leads: 3 });
    expect(res.body.perDay.reduce((n: number, d: { leads: number }) => n + d.leads, 0)).toBe(3);
    expect(res.body.dropOff).toBeUndefined();
  });

  it('shows where people stop for one campaign', async () => {
    const res = await owner.request(`/api/analytics?campaignId=${campaignId}`);
    expect(res.body.dropOff).toEqual([
      { id: 'budget', prompt: 'Budget?', answered: 2 },
      { id: 'when', prompt: 'When?', answered: 1 },
    ]);
  });

  it('respects the date range', async () => {
    const past = await owner.request('/api/analytics?from=2020-01-01&to=2020-02-01');
    expect(past.body.totals.leads).toBe(0);
    expect((await owner.request('/api/analytics?from=nope')).status).toBe(400);
  });

  it('never mixes businesses', async () => {
    const res = await other.request('/api/analytics');
    expect(res.body.totals.leads).toBe(0);
    const peek = await other.request(`/api/analytics?campaignId=${campaignId}`);
    expect(peek.body.dropOff).toBeUndefined();
  });
});
