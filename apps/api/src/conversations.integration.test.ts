import { createHmac } from 'node:crypto';
import type { CampaignConfigInput } from '@leadgen/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from './db/schema/index.js';
import { TEST_ENV } from './test/constants.js';
import { createBusinessWithOwner, createTestContext, type TestContext } from './test/helpers.js';
import { parseWebhook } from './whatsapp/webhook.js';

const PHONE_NUMBER_ID = '1000000000001';
const CUSTOMER = '919876543210';

const survey: CampaignConfigInput = {
  questions: [
    {
      id: 'interest',
      key: 'interest',
      type: 'single_choice',
      channel: 'form',
      prompt: 'Interested in?',
      options: [
        { id: 'sales', label: 'Sales' },
        { id: 'support', label: 'Support' },
      ],
    },
    {
      id: 'budget',
      key: 'budget',
      type: 'single_choice',
      channel: 'whatsapp',
      prompt: 'Hi {{name}}, what is your budget for {{answers.interest}}?',
      options: [
        { id: 'low', label: 'Low' },
        { id: 'high', label: 'High' },
      ],
    },
    {
      id: 'when',
      key: 'when',
      type: 'date',
      channel: 'whatsapp',
      prompt: 'When do you want to start?',
    },
  ],
  settings: {
    goal: 'lead',
    confirmation: 'Thanks {{name}}, we will call about {{answers.interest}}.',
  },
};

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof createBusinessWithOwner>>['owner'];
let campaignId: string;
let seq = 0;

function webhookBody(messages: unknown[], phoneNumberId = PHONE_NUMBER_ID) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          { field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, messages } },
        ],
      },
    ],
  };
}

const text = (body: string, from = CUSTOMER, id = `wamid.in.${++seq}`) => ({
  id,
  from,
  type: 'text',
  text: { body },
});
const tap = (replyId: string, title = '', from = CUSTOMER, id = `wamid.in.${++seq}`) => ({
  id,
  from,
  type: 'interactive',
  interactive: { type: 'button_reply', button_reply: { id: replyId, title } },
});

/** Delivers customer messages the way the webhook route would, but awaitable. */
const receive = (messages: unknown[], phoneNumberId?: string) =>
  ctx.conversations.handleWebhook(parseWebhook(webhookBody(messages, phoneNumberId)));

async function submitForm(fields: Record<string, string> = {}) {
  const body = new URLSearchParams({
    name: 'Asha Rao',
    phone: CUSTOMER,
    consent: 'yes',
    q_interest: 'sales',
    ...fields,
  });
  const res = await fetch(`${ctx.baseUrl}/f/survey`, { method: 'POST', body });
  expect(res.status).toBe(200);
  await ctx.settle();
}

const allLeads = () => ctx.db.select().from(schema.leads).orderBy(schema.leads.createdAt);
const latestLead = async () => (await allLeads()).at(-1)!;
const eventTypes = async (leadId: string) =>
  (
    await ctx.db
      .select()
      .from(schema.leadEvents)
      .where(eq(schema.leadEvents.leadId, leadId))
      .orderBy(schema.leadEvents.at)
  ).map((e) => e.type);

beforeAll(async () => {
  ctx = await createTestContext();
  ({ owner } = await createBusinessWithOwner(ctx, 'Acme Co', 'owner@acme.test'));
  const number = await owner.request('/api/whatsapp-numbers', {
    json: {
      phoneNumberId: PHONE_NUMBER_ID,
      displayNumber: '+91 99999 11111',
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
  const published = await owner.request(`/api/campaigns/${campaignId}/publish`, {
    method: 'POST',
    json: {},
  });
  expect(published.status).toBe(200);
});

beforeEach(async () => {
  ctx.graph.reset();
  await ctx.db.delete(schema.leads);
  await ctx.db.delete(schema.messages);
});

afterAll(() => ctx.close());

describe('webhook endpoint', () => {
  const url = () => `${ctx.baseUrl}/webhook`;
  const sign = (raw: string, secret: string = TEST_ENV.META_APP_SECRET) =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  it('answers Meta verification only with the right token', async () => {
    const ok = await fetch(
      `${url()}?hub.mode=subscribe&hub.verify_token=${TEST_ENV.META_VERIFY_TOKEN}&hub.challenge=12345`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    expect(
      (await fetch(`${url()}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status,
    ).toBe(403);
    expect((await fetch(url())).status).toBe(403);
  });

  it('rejects unsigned and wrongly signed posts', async () => {
    const raw = JSON.stringify(webhookBody([text('Hi')]));
    const post = (headers: Record<string, string>) =>
      fetch(url(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: raw,
      });
    expect((await post({})).status).toBe(401);
    expect((await post({ 'x-hub-signature-256': sign(raw, 'other-secret') })).status).toBe(401);
    expect((await post({ 'x-hub-signature-256': sign(raw + ' ') })).status).toBe(401);
  });

  it('acknowledges a signed post and processes it afterwards', async () => {
    await submitForm();
    ctx.graph.reset();
    const raw = JSON.stringify(webhookBody([text('Hi')]));
    const res = await fetch(url(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    for (let i = 0; i < 40 && ctx.graph.sent.length === 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    expect(ctx.graph.sent).toHaveLength(1);
  });

  it('rejects a signed body that is not JSON', async () => {
    const raw = 'not json';
    const res = await fetch(url(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw) },
      body: raw,
    });
    expect(res.status).toBe(400);
  });
});

describe('opening template', () => {
  it('sends hello_world in test mode when the form is submitted', async () => {
    await submitForm();
    expect(ctx.graph.sent).toHaveLength(1);
    expect(ctx.graph.sent[0]).toMatchObject({
      to: CUSTOMER,
      phoneNumberId: PHONE_NUMBER_ID,
      message: { kind: 'template', name: 'hello_world', language: 'en_US' },
    });
    const out = await ctx.db.select().from(schema.messages);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ direction: 'out', type: 'template', deliveryStatus: 'sent' });
    expect((await latestLead()).status).toBe('new');
  });

  it('still saves the lead when WhatsApp refuses the send', async () => {
    ctx.graph.failNext = 1;
    await submitForm();
    expect(await allLeads()).toHaveLength(1);
    expect(ctx.graph.sent).toHaveLength(0);
  });
});

describe('the conversation', () => {
  it('asks, skips what the form answered, personalises, and completes', async () => {
    await submitForm();
    ctx.graph.reset();

    await receive([text('Hi')]);
    let lead = await latestLead();
    expect(lead).toMatchObject({ status: 'in_conversation', currentQuestionId: 'budget' });
    expect(ctx.graph.sent).toHaveLength(1);
    expect(ctx.graph.sent[0]!.message).toMatchObject({
      kind: 'buttons',
      body: 'Hi Asha Rao, what is your budget for Sales?',
    });

    await receive([tap('budget:high', 'High')]);
    lead = await latestLead();
    expect(lead).toMatchObject({
      currentQuestionId: 'when',
      answers: { interest: 'sales', budget: 'high' },
    });

    await receive([text('1/2/2027')]);
    lead = await latestLead();
    expect(lead).toMatchObject({ status: 'completed', currentQuestionId: null });
    expect(lead.answers).toEqual({ interest: 'sales', budget: 'high', when: '2027-02-01' });
    expect(ctx.graph.sent.at(-1)!.message).toEqual({
      kind: 'text',
      body: 'Thanks Asha Rao, we will call about Sales.',
    });
    expect(lead.lastInboundAt).not.toBeNull();
    expect(await eventTypes(lead.id)).toEqual([
      'submitted',
      'first_reply',
      'answered',
      'answered',
      'completed',
    ]);

    const log = await ctx.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.leadId, lead.id));
    expect(log.filter((m) => m.direction === 'in')).toHaveLength(3);
    expect(log.filter((m) => m.direction === 'out')).toHaveLength(4); // template + 3 bot messages
  });

  it('nudges on free text and on a tap from an older message', async () => {
    await submitForm();
    ctx.graph.reset();
    await receive([text('Hi')]);
    await receive([text('whatever')]);
    expect(ctx.graph.sent.at(-1)!.message.kind).toBe('buttons');
    expect((ctx.graph.sent.at(-1)!.message as { body: string }).body).toContain('Please pick one');
    expect((await latestLead()).currentQuestionId).toBe('budget');

    await receive([tap('budget:low')]);
    await receive([tap('budget:high')]); // stale: the question has moved on
    const lead = await latestLead();
    expect(lead.answers).toMatchObject({ budget: 'low' });
    expect(lead.currentQuestionId).toBe('when');
  });

  it('processes a redelivered message only once', async () => {
    await submitForm();
    ctx.graph.reset();
    const hi = text('Hi', CUSTOMER, 'wamid.in.fixed');
    await receive([hi]);
    await receive([hi]);
    await receive([hi, hi]);
    expect(ctx.graph.sent).toHaveLength(1);
    expect(
      await ctx.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.waMessageId, 'wamid.in.fixed')),
    ).toHaveLength(1);
  });

  it('handles two identical taps arriving at once without double-counting', async () => {
    await submitForm();
    await receive([text('Hi')]);
    ctx.graph.reset();
    await Promise.all([receive([tap('budget:low')]), receive([tap('budget:low')])]);
    const lead = await latestLead();
    expect(lead.answers).toMatchObject({ budget: 'low' });
    expect(lead.currentQuestionId).toBe('when');
    expect(await eventTypes(lead.id)).toEqual(['submitted', 'first_reply', 'answered']);
    expect(ctx.graph.sent).toHaveLength(2); // the next question, then a nudge for the stale tap
  });

  it('matches the customer by the last ten digits of their number', async () => {
    await submitForm();
    ctx.graph.reset();
    await receive([text('Hi', '09876543210')]);
    expect((await latestLead()).status).toBe('in_conversation');
  });

  it('keeps the lead on the version it started with', async () => {
    await submitForm();
    ctx.graph.reset();
    const changed = JSON.parse(JSON.stringify(survey)) as CampaignConfigInput;
    changed.settings.confirmation = 'NEW TEXT';
    await owner.request(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      json: { draft: changed },
    });
    await owner.request(`/api/campaigns/${campaignId}/publish`, { method: 'POST', json: {} });

    await receive([text('Hi')]);
    await receive([tap('budget:low')]);
    await receive([text('2027-02-01')]);
    expect((ctx.graph.sent.at(-1)!.message as { body: string }).body).toContain(
      'we will call about',
    );

    await submitForm({ phone: '9811111111' });
    const newer = await latestLead();
    const [v1, v2] = await ctx.db
      .select()
      .from(schema.campaignVersions)
      .orderBy(schema.campaignVersions.version);
    expect((await allLeads())[0]!.campaignVersionId).toBe(v1!.id);
    expect(newer.campaignVersionId).toBe(v2!.id);
  });
});

describe('handing off', () => {
  it('pauses the bot, flags the lead, and stores later messages without replying', async () => {
    await submitForm();
    await receive([text('Hi')]);
    ctx.graph.reset();

    await receive([tap('budget:__human')]);
    let lead = await latestLead();
    expect(lead).toMatchObject({ status: 'needs_human', botPaused: true });
    expect((ctx.graph.sent[0]!.message as { body: string }).body).toContain(
      'someone from Acme Co will reply',
    );

    ctx.graph.reset();
    await receive([text('Hello? Anyone there?')]);
    expect(ctx.graph.sent).toHaveLength(0);
    lead = await latestLead();
    expect(lead.status).toBe('needs_human');
    const stored = await ctx.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.leadId, lead.id));
    expect(stored.some((m) => (m.body as { body?: string }).body === 'Hello? Anyone there?')).toBe(
      true,
    );
    expect(await eventTypes(lead.id)).toContain('handoff');
  });
});

describe('messages the bot should not act on', () => {
  it('stores but ignores messages from people with no open lead', async () => {
    await receive([text('Hi', '919000000000')]);
    expect(ctx.graph.sent).toHaveLength(0);
    const [stored] = await ctx.db.select().from(schema.messages);
    expect(stored).toMatchObject({ leadId: null, phone: '919000000000', direction: 'in' });
  });

  it('does not reply after the lead has completed', async () => {
    await submitForm({ q_interest: 'support' });
    await receive([text('Hi')]);
    await receive([tap('budget:low')]);
    await receive([text('1/2/2027')]);
    expect((await latestLead()).status).toBe('completed');
    ctx.graph.reset();
    await receive([text('thanks!')]);
    expect(ctx.graph.sent).toHaveLength(0);
  });

  it('ignores webhooks for numbers that are not connected', async () => {
    await submitForm();
    ctx.graph.reset();
    await receive([text('Hi')], 'unknown-number-id');
    expect(ctx.graph.sent).toHaveLength(0);
    expect((await latestLead()).status).toBe('new');
  });

  it("does not mix up businesses that share a customer's number", async () => {
    const other = await createBusinessWithOwner(ctx, 'Other Co', 'owner@other.test');
    const number = await other.owner.request('/api/whatsapp-numbers', {
      json: {
        phoneNumberId: '2000000000002',
        displayNumber: '9100000000',
        accessToken: 'EAAG-another-long-fake-token-1234567890',
      },
    });
    await other.owner.request('/api/campaigns', {
      json: {
        name: 'Other',
        slug: 'other',
        whatsappNumberId: number.body.number.id,
        draft: survey,
      },
    });
    await submitForm();
    ctx.graph.reset();
    // A message to the OTHER business's number must not advance Acme's lead.
    await receive([text('Hi')], '2000000000002');
    expect((await latestLead()).status).toBe('new');
    expect(ctx.graph.sent).toHaveLength(0);
  });
});

describe('failures', () => {
  it('leaves the conversation where it was when WhatsApp refuses a reply, and recovers', async () => {
    await submitForm();
    ctx.graph.reset();
    ctx.graph.failNext = 1;
    await receive([text('Hi')]);
    let lead = await latestLead();
    expect(lead).toMatchObject({ status: 'new', currentQuestionId: null });
    expect(await eventTypes(lead.id)).toEqual(['submitted']);

    await receive([text('Hi again')]);
    lead = await latestLead();
    expect(lead).toMatchObject({ status: 'in_conversation', currentQuestionId: 'budget' });
  });
});

describe('delivery statuses', () => {
  it('records the status Meta reports for an outgoing message', async () => {
    await submitForm();
    const [out] = await ctx.db.select().from(schema.messages);
    await ctx.conversations.handleWebhook({
      messages: [],
      statuses: [{ waMessageId: out!.waMessageId!, status: 'delivered' }],
    });
    const [after] = await ctx.db.select().from(schema.messages);
    expect(after!.deliveryStatus).toBe('delivered');
  });
});
