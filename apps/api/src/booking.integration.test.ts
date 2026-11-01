import {
  clinicExample,
  pubExample,
  restaurantExample,
  type CampaignConfigInput,
} from '@leadgen/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from './db/schema/index.js';
import { createBusinessWithOwner, createTestContext, type TestContext } from './test/helpers.js';
import { parseWebhook } from './whatsapp/webhook.js';

const PHONE_NUMBER_ID = '2000000000001';
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  startMinute: 0,
  endMinute: 1440,
}));

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof createBusinessWithOwner>>['owner'];
let orgId: string;
let numberId: string;
let seq = 0;

const payload = (messages: unknown[]) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages },
        },
      ],
    },
  ],
});

const phoneFor = (n: number) => `9198700${String(n).padStart(5, '0')}`;
const receive = (messages: unknown[]) =>
  ctx.conversations.handleWebhook(parseWebhook(payload(messages)));
const say = (from: string, body: string) =>
  receive([{ id: `wamid.in.${++seq}`, from, type: 'text', text: { body } }]);
const tap = (from: string, id: string) =>
  receive([
    {
      id: `wamid.in.${++seq}`,
      from,
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id, title: '' } },
    },
  ]);

type Row = { id: string; title: string; description?: string };
const lastMessage = () =>
  ctx.graph.sent.at(-1)!.message as { kind: string; body: string; options?: Row[] };
const rows = () => lastMessage().options ?? [];
const rowWith = (part: string) => {
  const row = rows().find((r) => r.id.includes(part));
  if (!row) throw new Error(`no option "${part}" in ${JSON.stringify(rows())}`);
  return row;
};

/** The last day offered: a full future day, unlike today, which may be half over. */
const fullDay = () =>
  rows()
    .filter((r) => r.id.includes(':d'))
    .at(-1)!;

async function createResource(name: string, extra: Record<string, unknown> = {}) {
  const res = await owner.request('/api/resources', {
    json: { name, kind: 'person', capacity: 1, slotMinutes: 30, hours: ALL_WEEK, ...extra },
  });
  expect(res.status).toBe(201);
  return res.body.resource.id as string;
}

async function publish(
  slug: string,
  draft: CampaignConfigInput,
  offerings: { resourceIds?: string[]; eventIds?: string[] },
) {
  const created = await owner.request('/api/campaigns', {
    json: { name: slug, slug, whatsappNumberId: numberId, draft },
  });
  expect(created.status).toBe(201);
  const id = created.body.campaign.id as string;
  await owner.request(`/api/campaigns/${id}/offerings`, {
    method: 'PUT',
    json: { resourceIds: offerings.resourceIds ?? [], eventIds: offerings.eventIds ?? [] },
  });
  const published = await owner.request(`/api/campaigns/${id}/publish`, {
    method: 'POST',
    json: {},
  });
  expect(published.status).toBe(200);
  return id;
}

async function submit(slug: string, phone: string, fields: Record<string, string>) {
  const res = await fetch(`${ctx.baseUrl}/f/${slug}`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'Asha Rao', phone, consent: 'yes', ...fields }),
  });
  expect(res.status).toBe(200);
  await ctx.settle();
  ctx.graph.reset();
}

const leadByPhone = async (phone: string) =>
  (await ctx.db.select().from(schema.leads).where(eq(schema.leads.phone, phone)))[0]!;
const bookingsOf = (leadId: string) =>
  ctx.db.select().from(schema.bookings).where(eq(schema.bookings.leadId, leadId));

/** Walks day → (part of day) → time, always taking the first choice. */
async function pickFirstSlot(phone: string) {
  await tap(phone, fullDay().id);
  if (rows().some((r) => r.id.includes(':p_'))) await tap(phone, rowWith(':p_').id);
  const time = rowWith(':t');
  await tap(phone, time.id);
  return time;
}

beforeAll(async () => {
  ctx = await createTestContext();
  ({ owner, id: orgId } = await createBusinessWithOwner(ctx, 'Acme Care', 'owner@care.test'));
  const number = await owner.request('/api/whatsapp-numbers', {
    json: {
      phoneNumberId: PHONE_NUMBER_ID,
      displayNumber: '+91 99999 22222',
      accessToken: 'EAAG-this-is-a-long-fake-access-token-1234567890',
    },
  });
  numberId = number.body.number.id;
});

beforeEach(() => {
  ctx.graph.reset();
});

afterAll(() => ctx.close());

describe('clinic: the customer picks a doctor, then a time', () => {
  it('books over WhatsApp and confirms with the booking details', async () => {
    const rao = await createResource('Dr. Rao');
    const iyer = await createResource('Dr. Iyer');
    await publish('clinic', clinicExample, { resourceIds: [rao, iyer] });
    const phone = phoneFor(1);
    await submit('clinic', phone, { q_reason: 'skin' });

    await say(phone, 'Hi');
    await tap(phone, 'first_visit:yes');
    expect(lastMessage().body).toContain('Who would you like to see for Skin?');
    expect(rows().map((r) => r.title)).toEqual([
      'Any available',
      'Dr. Iyer',
      'Dr. Rao',
      'Talk to a human',
    ]);

    await tap(phone, rowWith(rao).id);
    expect(lastMessage().body).toBe('When suits you?');
    expect(rows().length).toBeGreaterThan(1);
    expect(rows()[0]!.title).toMatch(/^\w{3} \d{1,2} \w{3}$/);

    await tap(phone, fullDay().id);
    // A full day of 30-minute slots is too many for one list, so it asks for a part of day.
    expect(rows().map((r) => r.title)).toEqual([
      'Morning',
      'Afternoon',
      'Evening',
      'Talk to a human',
    ]);
    await tap(phone, rowWith(':p_morning').id);
    expect(rows().filter((r) => r.id.includes(':t')).length).toBeLessThanOrEqual(10);
    expect(rows().some((r) => r.title === 'Show later times')).toBe(true);
    await tap(phone, rowWith('more').id);
    const time = rows().find((r) => r.id.includes(':t'))!;
    await tap(phone, time.id);

    const lead = await leadByPhone(phone);
    expect(lead.status).toBe('completed');
    const [booking] = await bookingsOf(lead.id);
    expect(booking).toMatchObject({ resourceId: rao, status: 'confirmed', partySize: 1 });
    expect(lastMessage().body).toMatch(
      /^You're booked, Asha Rao: Dr\. Rao on \w{3} \d+ \w{3} at \d+:\d\d (AM|PM)\./,
    );
    expect(lead.answers.slot).toBe(booking!.startsAt.toISOString());
  });

  it('"Any available" books whichever doctor is free', async () => {
    const phone = phoneFor(2);
    await submit('clinic', phone, { q_reason: 'dental' });
    await say(phone, 'Hi');
    await tap(phone, 'first_visit:no');
    await tap(phone, rowWith(':any').id);
    await pickFirstSlot(phone);
    const lead = await leadByPhone(phone);
    expect(lead.status).toBe('completed');
    const [booking] = await bookingsOf(lead.id);
    expect(booking!.resourceId).not.toBeNull();
  });

  it('refuses a slot that was taken, and offers the times again', async () => {
    const phone = phoneFor(3);
    await submit('clinic', phone, { q_reason: 'skin' });
    await say(phone, 'Hi');
    await tap(phone, 'first_visit:yes');
    const rao = (
      await ctx.db.select().from(schema.resources).where(eq(schema.resources.name, 'Dr. Rao'))
    )[0]!;
    await tap(phone, rowWith(rao.id).id);
    await tap(phone, fullDay().id);
    await tap(phone, rowWith(':p_').id);
    const time = rowWith(':t');
    // Someone else books it between the list being shown and the tap.
    const startsAt = new Date(Number(time.id.split(':t')[1]));
    const [other] = await ctx.db.select().from(schema.leads).limit(1);
    await ctx.db.insert(schema.bookings).values({
      organizationId: orgId,
      leadId: other!.id,
      resourceId: rao.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      status: 'confirmed',
    });
    await tap(phone, time.id);
    expect(lastMessage().body).toContain('Sorry, that time was just taken');
    expect(rows().some((r) => r.id === time.id)).toBe(false);
    expect((await leadByPhone(phone)).status).toBe('in_conversation');
  });

  it('shows no times that are taken, and hides time off', async () => {
    const [rao] = await ctx.db
      .select()
      .from(schema.resources)
      .where(eq(schema.resources.name, 'Dr. Rao'));
    const phone = phoneFor(4);
    await submit('clinic', phone, { q_reason: 'skin' });
    await say(phone, 'Hi');
    await tap(phone, 'first_visit:yes');
    await tap(phone, rowWith(rao!.id).id);
    const first = rows().find((r) => r.id.includes(':d'))!;
    // Block the whole of tomorrow-ish with time off and expect that day to disappear.
    const day = first.title;
    await owner.request(`/api/resources/${rao!.id}/time-off`, {
      json: {
        startsAt: new Date(Date.now() - 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      },
    });
    await say(phone, 'ok');
    expect(rows().some((r) => r.title === day)).toBe(false);
  });
});

describe('restaurant: tables are assigned automatically and party size counts', () => {
  it('lets two parties share a table until it is full', async () => {
    const table = await createResource('Table 1', { kind: 'table', capacity: 4, slotMinutes: 60 });
    await publish('dinner', restaurantExample, { resourceIds: [table] });

    const a = phoneFor(10);
    const b = phoneFor(11);
    const c = phoneFor(12);
    // Party of 3 takes 3 of the table's 4 seats at the first free time.
    await submit('dinner', a, { q_party: '3' });
    await say(a, 'Hi');
    await tap(a, 'occasion:none');
    await tap(a, fullDay().id);
    await tap(a, rowWith(':p_').id);
    const time = rowWith(':t');
    await tap(a, time.id);
    expect((await leadByPhone(a)).status).toBe('completed');

    // A party of 2 no longer fits that time; a party of 1 still does.
    const startsAt = new Date(Number(time.id.split(':t')[1]));
    const fitsAt = async (phone: string, party: string) => {
      await submit('dinner', phone, { q_party: party });
      await say(phone, 'Hi');
      await tap(phone, 'occasion:none');
      const day = fullDay();
      await tap(phone, day.id);
      const parts = rows().filter((r) => r.id.includes(':p_'));
      const times: Row[] = [];
      for (const part of parts) {
        await tap(phone, part.id);
        times.push(...rows().filter((r) => r.id.includes(':t')));
        // Show every page of times for this part.
        while (rows().some((r) => r.id.includes(':more'))) {
          await tap(phone, rowWith(':more').id);
          times.push(...rows().filter((r) => r.id.includes(':t')));
        }
        await tap(phone, day.id);
      }
      return times.some((t) => t.id.endsWith(`:t${startsAt.getTime()}`));
    };
    expect(await fitsAt(b, '2')).toBe(false);
    expect(await fitsAt(c, '1')).toBe(true);
  });
});

describe('pub: guests book a spot at an event', () => {
  it('lists events with room and books the chosen one', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000);
    const mk = async (name: string, capacity: number, days: number) =>
      (
        await owner.request('/api/events', {
          json: {
            name,
            capacity,
            startsAt: new Date(soon.getTime() + days * 86_400_000).toISOString(),
            endsAt: new Date(soon.getTime() + days * 86_400_000 + 4 * 3_600_000).toISOString(),
          },
        })
      ).body.event.id as string;
    const dj = await mk('DJ Night', 10, 0);
    const diwali = await mk('Diwali Party', 3, 1);
    await publish('pub', pubExample, { eventIds: [dj, diwali] });

    const guest = phoneFor(20);
    await submit('pub', guest, { q_party: '4' });
    await say(guest, 'Hi');
    // A group of 4 doesn't fit Diwali (3 spots), so there is only one event and no choice to make.
    expect(lastMessage().body).toBe('Any seating preference?');
    const [booking] = await bookingsOf((await leadByPhone(guest)).id);
    expect(booking).toMatchObject({ eventId: dj, partySize: 4, status: 'confirmed' });

    await tap(guest, 'table_pref:floor');
    const lead = await leadByPhone(guest);
    expect(lead.status).toBe('completed');
    expect(lastMessage().body).toMatch(
      /^You're on the list, Asha Rao! DJ Night, \w{3} \d+ \w{3}, doors/,
    );

    // A smaller group sees both events and can choose.
    const pair = phoneFor(21);
    await submit('pub', pair, { q_party: '2' });
    await say(pair, 'Hi');
    expect(rows().map((r) => r.title)).toEqual(['DJ Night', 'Diwali Party', 'Talk to a human']);
    await tap(pair, rowWith(diwali).id);
    expect(lastMessage().body).toBe('Any seating preference?');
  });
});

describe('approval', () => {
  it('holds the booking as pending and says so', async () => {
    const room = await createResource('Court 1', { kind: 'court' });
    await publish(
      'courts',
      {
        questions: [
          { id: 'slot', key: 'slot', type: 'pick_slot', channel: 'whatsapp', prompt: 'When?' },
        ],
        settings: {
          goal: 'booking',
          resourceSelection: 'auto_assign',
          requiresApproval: true,
          reminderTemplate: { name: 'r', language: 'en', params: [] },
          confirmation: 'Booked, {{name}}.',
        },
      },
      { resourceIds: [room] },
    );
    const phone = phoneFor(30);
    await submit('courts', phone, {});
    await say(phone, 'Hi');
    await pickFirstSlot(phone);
    expect(lastMessage().body).toMatch(
      /^Thanks Asha Rao, your request for .* has been sent to Acme Care/,
    );
    const [booking] = await bookingsOf((await leadByPhone(phone)).id);
    expect(booking!.status).toBe('pending');

    // A pending booking still holds the slot.
    const other = phoneFor(31);
    await submit('courts', other, {});
    await say(other, 'Hi');
    await tap(other, fullDay().id);
    const stillOffered = rows().some((r) => r.id.endsWith(`:t${booking!.startsAt.getTime()}`));
    expect(stillOffered).toBe(false);
  });
});

describe('overbooking', () => {
  it('lets only one of two simultaneous taps have the last slot', async () => {
    const solo = await createResource('Solo Studio', { kind: 'room' });
    await publish(
      'studio',
      {
        questions: [
          { id: 'slot', key: 'slot', type: 'pick_slot', channel: 'whatsapp', prompt: 'When?' },
        ],
        settings: {
          goal: 'booking',
          resourceSelection: 'auto_assign',
          reminderTemplate: { name: 'r', language: 'en', params: [] },
          confirmation: 'Booked, {{name}}.',
        },
      },
      { resourceIds: [solo] },
    );
    const phones = [40, 41, 42, 43, 44].map(phoneFor);
    for (const phone of phones) {
      await submit('studio', phone, {});
      await say(phone, 'Hi');
      await tap(phone, fullDay().id);
      await tap(phone, rowWith(':p_').id);
    }
    const time = rowWith(':t').id; // every customer is looking at the same first time
    ctx.graph.reset();
    await Promise.all(phones.map((phone) => tap(phone, time)));

    const startsAt = new Date(Number(time.split(':t')[1]));
    const held = await ctx.db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.resourceId, solo), eq(schema.bookings.startsAt, startsAt)));
    expect(held).toHaveLength(1);
    const winners = (
      await Promise.all(phones.map(async (p) => (await leadByPhone(p)).status))
    ).filter((s) => s === 'completed');
    expect(winners).toHaveLength(1);
  });
});
