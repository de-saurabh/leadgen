import type { CampaignConfigInput } from '@leadgen/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from './db/schema/index.js';
import { createChat } from './test/chat.js';
import {
  createBusinessWithOwner,
  createTestContext,
  type TestClient,
  type TestContext,
} from './test/helpers.js';

const PHONE_NUMBER_ID = '4000000000001';
const CUSTOMER = '919876500001';

const survey: CampaignConfigInput = {
  questions: [
    {
      id: 'budget',
      key: 'budget',
      type: 'single_choice',
      channel: 'whatsapp',
      prompt: 'What is your budget?',
      options: [
        { id: 'low', label: 'Low' },
        { id: 'high', label: 'High' },
      ],
    },
    { id: 'when', key: 'when', type: 'date', channel: 'whatsapp', prompt: 'When do you start?' },
  ],
  settings: { goal: 'lead', confirmation: 'Thanks {{name}}, we will call you.' },
};

let ctx: TestContext;
let owner: TestClient;
let other: TestClient;
let chat: ReturnType<typeof createChat>;
let orgId: string;

async function newLead(phone = CUSTOMER) {
  await fetch(`${ctx.baseUrl}/f/survey`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'Asha Rao', phone, consent: 'yes' }),
  });
  await ctx.settle();
  ctx.graph.reset();
  const [lead] = await ctx.db.select().from(schema.leads).where(eq(schema.leads.phone, phone));
  return lead!;
}
const leadRow = async (id: string) =>
  (await ctx.db.select().from(schema.leads).where(eq(schema.leads.id, id)))[0]!;

beforeAll(async () => {
  ctx = await createTestContext();
  ({ owner, id: orgId } = await createBusinessWithOwner(ctx, 'Acme Co', 'owner@acme.test'));
  ({ owner: other } = await createBusinessWithOwner(ctx, 'Other Co', 'owner@other.test'));
  chat = createChat(ctx, PHONE_NUMBER_ID);
  const number = await owner.request('/api/whatsapp-numbers', {
    json: {
      phoneNumberId: PHONE_NUMBER_ID,
      displayNumber: '+91 99999 44444',
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
  await owner.request(`/api/campaigns/${campaign.body.campaign.id}/publish`, {
    method: 'POST',
    json: {},
  });
});

beforeEach(async () => {
  ctx.graph.reset();
  await ctx.db.delete(schema.leads);
});

afterAll(() => ctx.close());

describe('leads', () => {
  it('lists and finds leads, with people waiting for a reply first', async () => {
    const waiting = await newLead('919876500010');
    const fresh = await newLead('919876500011');
    await chat.say(waiting.phone, 'Hi');
    await chat.say(waiting.phone, 'human');

    const all = await owner.request('/api/leads');
    expect(all.body.leads.map((l: { id: string }) => l.id)).toEqual([waiting.id, fresh.id]);
    expect(all.body.leads[0]).toMatchObject({ status: 'needs_human', campaignName: 'Survey' });

    const byStatus = await owner.request('/api/leads?status=needs_human');
    expect(byStatus.body.leads).toHaveLength(1);
    const byText = await owner.request('/api/leads?q=0011');
    expect(byText.body.leads.map((l: { id: string }) => l.id)).toEqual([fresh.id]);
    expect((await owner.request('/api/leads?status=bogus')).status).toBe(400);
  });

  it('shows one lead with its answers and the whole chat', async () => {
    const lead = await newLead();
    await chat.say(lead.phone, 'Hi');
    await chat.tap(lead.phone, 'budget:high');
    const res = await owner.request(`/api/leads/${lead.id}`);
    expect(res.status).toBe(200);
    expect(res.body.lead).toMatchObject({ name: 'Asha Rao', status: 'in_conversation' });
    expect(res.body.answers).toEqual([
      { key: 'budget', question: 'What is your budget?', type: 'single_choice', value: 'high' },
    ]);
    const directions = res.body.messages.map((m: { direction: string }) => m.direction);
    expect(directions).toEqual(['out', 'in', 'out', 'in', 'out']);
  });

  it('keeps businesses apart', async () => {
    const lead = await newLead();
    expect((await other.request('/api/leads')).body.leads).toEqual([]);
    expect((await other.request(`/api/leads/${lead.id}`)).status).toBe(404);
    for (const action of ['reply', 'hand-back', 'close']) {
      const res = await other.request(`/api/leads/${lead.id}/${action}`, {
        json: { text: 'hello' },
      });
      expect(res.status).toBe(404);
    }
    expect((await leadRow(lead.id)).status).toBe('new');
  });
});

describe('a person takes over a chat', () => {
  it('replies, keeps the bot quiet, then hands the chat back', async () => {
    const lead = await newLead();
    await chat.say(lead.phone, 'Hi');
    await chat.tap(lead.phone, 'budget:__human');
    expect((await leadRow(lead.id)).status).toBe('needs_human');
    ctx.graph.reset();

    const reply = await owner.request(`/api/leads/${lead.id}/reply`, {
      json: { text: 'Hi Asha, how can I help?' },
    });
    expect(reply.status).toBe(204);
    expect(ctx.graph.sent.at(-1)).toMatchObject({
      to: lead.phone,
      message: { kind: 'text', body: 'Hi Asha, how can I help?' },
    });
    const detail = await owner.request(`/api/leads/${lead.id}`);
    const sentByStaff = detail.body.messages.at(-1);
    expect(sentByStaff.sentByUserId).toBeTruthy();

    // The customer answers the person; the bot says nothing but the message is kept.
    ctx.graph.reset();
    await chat.say(lead.phone, 'I want a quote');
    expect(ctx.graph.sent).toHaveLength(0);
    expect((await owner.request(`/api/leads/${lead.id}`)).body.messages.at(-1)).toMatchObject({
      direction: 'in',
    });

    const back = await owner.request(`/api/leads/${lead.id}/hand-back`, { json: {} });
    expect(back.status).toBe(204);
    expect(chat.lastMessage().body).toBe('What is your budget?');
    expect(await leadRow(lead.id)).toMatchObject({
      status: 'in_conversation',
      botPaused: false,
      currentQuestionId: 'budget',
    });

    // And the bot carries on from there.
    await chat.tap(lead.phone, 'budget:low');
    expect(chat.lastMessage().body).toContain('When do you start?');
  });

  it('only hands back a chat that is waiting for a person', async () => {
    const lead = await newLead();
    const res = await owner.request(`/api/leads/${lead.id}/hand-back`, { json: {} });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('bad_state');
  });

  it('refuses to message once the 24 hour window has closed', async () => {
    const lead = await newLead();
    await chat.say(lead.phone, 'human');
    await ctx.db
      .update(schema.leads)
      .set({ lastInboundAt: new Date(Date.now() - 30 * 3_600_000) })
      .where(eq(schema.leads.id, lead.id));
    ctx.graph.reset();
    const reply = await owner.request(`/api/leads/${lead.id}/reply`, { json: { text: 'Hello' } });
    expect(reply.status).toBe(409);
    expect(reply.body.error).toBe('window_closed');
    expect((await owner.request(`/api/leads/${lead.id}/hand-back`, { json: {} })).status).toBe(409);
    expect(ctx.graph.sent).toHaveLength(0);
  });

  it('closes a lead that was dealt with', async () => {
    const lead = await newLead();
    await chat.say(lead.phone, 'human');
    expect((await owner.request(`/api/leads/${lead.id}/close`, { json: {} })).status).toBe(204);
    expect(await leadRow(lead.id)).toMatchObject({ status: 'completed', botPaused: false });
    expect((await owner.request(`/api/leads/${lead.id}/close`, { json: {} })).status).toBe(409);
  });
});

describe('live updates', () => {
  it('streams a customer message to the business that owns it, and no one else', async () => {
    const lead = await newLead();
    const received: string[] = [];
    const abort = new AbortController();
    const listen = async (client: TestClient, into: string[]) => {
      const res = await fetch(`${ctx.baseUrl}/api/stream`, {
        headers: { cookie: client.cookieHeader() },
        signal: abort.signal,
      });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            into.push(decoder.decode(value));
          }
        } catch {
          // Closed by the test.
        }
      })();
    };
    const strangers: string[] = [];
    await listen(owner, received);
    await listen(other, strangers);
    await new Promise((r) => setTimeout(r, 150));

    await chat.say(lead.phone, 'Hi');
    await new Promise((r) => setTimeout(r, 200));
    abort.abort();

    const text = received.join('');
    expect(text).toContain(`"type":"message","leadId":"${lead.id}"`);
    expect(strangers.join('')).not.toContain(lead.id);
  });

  it('needs a signed-in user', async () => {
    expect((await fetch(`${ctx.baseUrl}/api/stream`)).status).toBe(401);
  });
});

describe('team', () => {
  it('adds people, changes roles and removes them, always keeping an owner', async () => {
    const add = await owner.request('/api/team', {
      json: { name: 'Front Desk', email: 'desk@acme.test', role: 'manager' },
    });
    expect(add.status).toBe(201);
    expect(add.body.generatedPassword).toBeTruthy();
    expect(
      (
        await owner.request('/api/team', {
          json: { name: 'x', email: 'desk@acme.test', role: 'member' },
        })
      ).status,
    ).toBe(409);

    const team = (await owner.request('/api/team')).body.team as Array<{
      memberId: string;
      email: string;
      role: string;
    }>;
    expect(team.map((t) => t.role).sort()).toEqual(['manager', 'owner']);
    const me = team.find((t) => t.email === 'owner@acme.test')!;
    const desk = team.find((t) => t.email === 'desk@acme.test')!;

    expect(
      (
        await owner.request(`/api/team/${me.memberId}`, {
          method: 'PATCH',
          json: { role: 'manager' },
        })
      ).status,
    ).toBe(422);
    expect((await owner.request(`/api/team/${me.memberId}`, { method: 'DELETE' })).status).toBe(
      422,
    );
    expect(
      (
        await owner.request(`/api/team/${desk.memberId}`, {
          method: 'PATCH',
          json: { role: 'member' },
        })
      ).status,
    ).toBe(204);
    expect((await owner.request(`/api/team/${desk.memberId}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await other.request(`/api/team/${desk.memberId}`, { method: 'DELETE' })).status).toBe(
      404,
    );
  });

  it('lets a new person sign in, with only the access their role gives', async () => {
    const add = await owner.request('/api/team', {
      json: { name: 'Dr. Rao', email: 'rao@acme.test', role: 'member' },
    });
    const staff = ctx.client();
    expect((await staff.signIn('rao@acme.test', add.body.generatedPassword)).status).toBe(200);
    expect((await staff.request('/api/leads')).status).toBe(403);
    expect((await staff.request('/api/team')).status).toBe(403);
    expect((await staff.request('/api/bookings')).status).toBe(200);
  });

  it('shows a member only the bookings on their own resources', async () => {
    const add = await owner.request('/api/team', {
      json: { name: 'Dr. Iyer', email: 'iyer@acme.test', role: 'member' },
    });
    const staff = ctx.client();
    await staff.signIn('iyer@acme.test', add.body.generatedPassword);
    const mine = (await owner.request('/api/team')).body.team.find(
      (t: { email: string }) => t.email === 'iyer@acme.test',
    );
    const hours = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      startMinute: 0,
      endMinute: 1440,
    }));
    const own = await owner.request('/api/resources', {
      json: {
        name: 'Dr. Iyer',
        kind: 'person',
        capacity: 1,
        slotMinutes: 30,
        hours,
        memberUserId: mine.userId,
      },
    });
    const shared = await owner.request('/api/resources', {
      json: { name: 'Front room', kind: 'room', capacity: 1, slotMinutes: 30, hours },
    });
    const lead = await newLead('919876500020');
    const at = (h: number) => new Date(Date.now() + (48 + h) * 3_600_000);
    for (const [resourceId, h] of [
      [own.body.resource.id, 0],
      [shared.body.resource.id, 1],
    ] as const) {
      await ctx.db.insert(schema.bookings).values({
        organizationId: orgId,
        leadId: lead.id,
        resourceId,
        startsAt: at(h),
        endsAt: at(h + 0.5),
        status: 'confirmed',
      });
    }
    const theirs = (await staff.request('/api/bookings')).body.bookings;
    expect(theirs.map((b: { what: string }) => b.what)).toEqual(['Dr. Iyer']);
    expect((await owner.request('/api/bookings')).body.bookings).toHaveLength(2);
  });
});
