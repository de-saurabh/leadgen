import type { CampaignConfigInput } from '@leadgen/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from './db/schema/index.js';
import { dropStaleLeads } from './services/staleLeads.js';
import { createChat } from './test/chat.js';
import { createBusinessWithOwner, createTestContext, type TestContext } from './test/helpers.js';

const PHONE_NUMBER_ID = '3000000000001';
const ALL_WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  startMinute: 0,
  endMinute: 1440,
}));

const config = (over: Partial<CampaignConfigInput['settings']> = {}): CampaignConfigInput => ({
  questions: [{ id: 'slot', key: 'slot', type: 'pick_slot', channel: 'whatsapp', prompt: 'When?' }],
  settings: {
    goal: 'booking',
    resourceSelection: 'auto_assign',
    reminderOffsets: [180, 60],
    reminderTemplate: { name: 'booking_reminder', language: 'en', params: ['{{name}}'] },
    confirmation: 'Booked, {{name}}: {{booking.date}} at {{booking.time}}.',
    ...over,
  },
});

let ctx: TestContext;
let owner: Awaited<ReturnType<typeof createBusinessWithOwner>>['owner'];
let chat: ReturnType<typeof createChat>;
let numberId: string;
let resourceId: string;
let nextPhone = 0;

const newPhone = () => `9198800${String(++nextPhone).padStart(5, '0')}`;

async function publish(slug: string, draft: CampaignConfigInput) {
  const created = await owner.request('/api/campaigns', {
    json: { name: slug, slug, whatsappNumberId: numberId, draft },
  });
  const id = created.body.campaign.id as string;
  await owner.request(`/api/campaigns/${id}/offerings`, {
    method: 'PUT',
    json: { resourceIds: [resourceId], eventIds: [] },
  });
  const res = await owner.request(`/api/campaigns/${id}/publish`, { method: 'POST', json: {} });
  expect(res.status).toBe(200);
}

/** Takes a customer from the form through to a booked slot on a future day. */
async function bookSlot(slug: string, phone = newPhone()) {
  await fetch(`${ctx.baseUrl}/f/${slug}`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'Asha Rao', phone, consent: 'yes' }),
  });
  await ctx.settle();
  await chat.say(phone, 'Hi');
  await chat.tap(phone, chat.fullDay().id);
  await chat.tap(phone, chat.rowWith(':p_').id);
  await chat.tap(phone, chat.rowWith(':t').id);
  const [lead] = await ctx.db.select().from(schema.leads).where(eq(schema.leads.phone, phone));
  const [booking] = await ctx.db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.leadId, lead!.id));
  return { phone, lead: lead!, booking: booking! };
}

const statusOf = async (id: string) =>
  (await ctx.db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0]!.status;

beforeAll(async () => {
  ctx = await createTestContext();
  ({ owner } = await createBusinessWithOwner(ctx, 'Acme Studio', 'owner@studio.test'));
  chat = createChat(ctx, PHONE_NUMBER_ID);
  const number = await owner.request('/api/whatsapp-numbers', {
    json: {
      phoneNumberId: PHONE_NUMBER_ID,
      displayNumber: '+91 99999 33333',
      accessToken: 'EAAG-this-is-a-long-fake-access-token-1234567890',
    },
  });
  numberId = number.body.number.id;
  const resource = await owner.request('/api/resources', {
    json: { name: 'Studio', kind: 'room', capacity: 1, slotMinutes: 30, hours: ALL_WEEK },
  });
  resourceId = resource.body.resource.id;
  await publish('studio', config());
  await publish('review', config({ requiresApproval: true }));
});

beforeEach(() => {
  ctx.graph.reset();
  ctx.scheduled.length = 0;
  ctx.setNow();
});

afterAll(() => ctx.close());

describe('reminders', () => {
  it('are queued for every offset once the booking is confirmed', async () => {
    const { booking } = await bookSlot('studio');
    expect(ctx.scheduled.map((s) => s.job.offset).sort((a, b) => a - b)).toEqual([60, 180]);
    for (const { job, at } of ctx.scheduled) {
      expect(job).toMatchObject({
        bookingId: booking.id,
        startsAt: booking.startsAt.toISOString(),
      });
      expect(at.getTime()).toBe(booking.startsAt.getTime() - job.offset * 60_000);
    }
  });

  it('arrive with buttons to reschedule or cancel while the chat is open', async () => {
    const { booking, phone } = await bookSlot('studio');
    ctx.graph.reset();
    const outcome = await ctx.reminders.send(ctx.scheduled[0]!.job);
    expect(outcome).toBe('sent');
    expect(ctx.graph.sent.at(-1)).toMatchObject({
      to: phone,
      message: {
        kind: 'buttons',
        body: expect.stringContaining('Reminder from Acme Studio: Studio on'),
      },
    });
    expect(chat.rows().map((r) => r.title)).toEqual(['Reschedule', 'Cancel']);
    expect(await statusOf(booking.id)).toBe('confirmed');
  });

  it('fall back to a template once the 24 hour window has closed', async () => {
    const { lead } = await bookSlot('studio');
    await ctx.db
      .update(schema.leads)
      .set({ lastInboundAt: new Date(Date.now() - 30 * 3_600_000) })
      .where(eq(schema.leads.id, lead.id));
    ctx.graph.reset();
    expect(await ctx.reminders.send(ctx.scheduled.at(-1)!.job)).toBe('sent');
    expect(ctx.graph.sent.at(-1)!.message).toMatchObject({ kind: 'template', name: 'hello_world' });
  });

  it('are skipped when the booking was cancelled, moved, or has started', async () => {
    const { booking } = await bookSlot('studio');
    const job = ctx.scheduled[0]!.job;
    ctx.graph.reset();

    expect(await ctx.reminders.send({ ...job, startsAt: new Date(0).toISOString() })).toBe(
      'skipped',
    );
    ctx.setNow(new Date(booking.startsAt.getTime() + 1000));
    expect(await ctx.reminders.send(job)).toBe('skipped');
    ctx.setNow();
    await ctx.db
      .update(schema.bookings)
      .set({ status: 'cancelled' })
      .where(eq(schema.bookings.id, booking.id));
    expect(await ctx.reminders.send(job)).toBe('skipped');
    expect(ctx.graph.sent).toHaveLength(0);
  });

  it('skip offsets that are already in the past', async () => {
    const { booking } = await bookSlot('studio');
    ctx.scheduled.length = 0;
    // Two hours before the start: the 3-hour reminder is gone, the 1-hour one is not.
    ctx.setNow(new Date(booking.startsAt.getTime() - 2 * 3_600_000));
    expect(await ctx.reminders.scheduleFor(booking.id)).toBe(1);
    expect(ctx.scheduled[0]!.job.offset).toBe(60);
  });

  it('wait for approval before being queued', async () => {
    const { booking } = await bookSlot('review');
    expect(booking.status).toBe('pending');
    expect(ctx.scheduled).toHaveLength(0);
    const res = await owner.request(`/api/bookings/${booking.id}`, {
      method: 'PATCH',
      json: { status: 'confirmed' },
    });
    expect(res.status).toBe(200);
    expect(ctx.scheduled).toHaveLength(2);
  });
});

describe('the customer changes a booking', () => {
  it('cancels from the confirmation buttons, after being asked to be sure', async () => {
    const { booking, phone } = await bookSlot('studio');
    expect(chat.lastMessage().kind).toBe('buttons');
    expect(chat.rows().map((r) => r.title)).toEqual(['Reschedule', 'Cancel']);

    await chat.tap(phone, '_booking:cancel');
    expect(chat.lastMessage().body).toMatch(/^Cancel Studio on .* at .*\?$/);
    expect(await statusOf(booking.id)).toBe('confirmed');

    await chat.tap(phone, '_booking:keep');
    expect(chat.lastMessage().body).toBe('Great, your booking is still on.');
    expect(await statusOf(booking.id)).toBe('confirmed');

    await chat.say(phone, 'actually please cancel it');
    await chat.tap(phone, '_booking:cancel_yes');
    expect(chat.lastMessage().body).toMatch(/has been cancelled\.$/);
    expect(await statusOf(booking.id)).toBe('cancelled');

    // Nothing left to change, and the reminder no longer goes out.
    ctx.graph.reset();
    await chat.say(phone, 'hello?');
    expect(ctx.graph.sent).toHaveLength(0);
    expect(await ctx.reminders.send(ctx.scheduled[0]!.job)).toBe('skipped');
  });

  it('offers the options when they just say something', async () => {
    const { phone } = await bookSlot('studio');
    await chat.say(phone, 'thanks!');
    expect(chat.lastMessage().body).toMatch(/^Your booking: Studio on .* Need to change it\?$/);
    expect(chat.rows().map((r) => r.title)).toEqual(['Reschedule', 'Cancel']);
  });

  it('reschedules: the new time is booked and the old one is released', async () => {
    const { booking: first, phone, lead } = await bookSlot('studio');
    ctx.scheduled.length = 0;

    await chat.say(phone, 'can I reschedule?');
    expect(chat.lastMessage().body).toBe('When?');
    expect(await statusOf(first.id)).toBe('confirmed'); // still held until a new time is chosen

    // Pick a different day so it can't be the same slot.
    const days = chat.rows().filter((r) => r.id.includes(':d'));
    await chat.tap(phone, days[days.length - 2]!.id);
    await chat.tap(phone, chat.rowWith(':p_').id);
    await chat.tap(phone, chat.rowWith(':t').id);

    const all = await ctx.db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.leadId, lead.id));
    expect(all).toHaveLength(2);
    const second = all.find((b) => b.id !== first.id)!;
    expect(second).toMatchObject({ status: 'confirmed', rescheduledFromId: first.id });
    expect(second.startsAt.getTime()).not.toBe(first.startsAt.getTime());
    expect(await statusOf(first.id)).toBe('cancelled');
    expect(chat.lastMessage().body).toMatch(/^Booked, Asha Rao:/);

    // Reminders follow the new booking; the old ones now skip.
    expect(ctx.scheduled.every((s) => s.job.bookingId === second.id)).toBe(true);
    expect(ctx.scheduled).toHaveLength(2);
    expect(
      await ctx.reminders.send({
        bookingId: first.id,
        startsAt: first.startsAt.toISOString(),
        offset: 180,
      }),
    ).toBe('skipped');
    expect(
      (await ctx.db.select().from(schema.leads).where(eq(schema.leads.id, lead.id)))[0]!.status,
    ).toBe('completed');
  });

  it('keeps the old booking if they walk away mid-reschedule', async () => {
    const { booking, phone, lead } = await bookSlot('studio');
    await chat.tap(phone, '_booking:reschedule');
    expect(chat.lastMessage().body).toBe('When?');
    await ctx.db
      .update(schema.leads)
      .set({ lastInboundAt: new Date(Date.now() - 30 * 3_600_000) })
      .where(eq(schema.leads.id, lead.id));

    expect(await dropStaleLeads(ctx.db)).toBeGreaterThanOrEqual(1);
    expect(
      (await ctx.db.select().from(schema.leads).where(eq(schema.leads.id, lead.id)))[0]!.status,
    ).toBe('dropped');
    expect(await statusOf(booking.id)).toBe('confirmed');
  });
});

describe('stale leads', () => {
  const submit = async (slug: string, phone: string) => {
    await fetch(`${ctx.baseUrl}/f/${slug}`, {
      method: 'POST',
      body: new URLSearchParams({ name: 'Asha Rao', phone, consent: 'yes' }),
    });
    await ctx.settle();
    return (await ctx.db.select().from(schema.leads).where(eq(schema.leads.phone, phone)))[0]!;
  };
  const age = (leadId: string, hours: number) =>
    ctx.db
      .update(schema.leads)
      .set({ lastInboundAt: new Date(Date.now() - hours * 3_600_000) })
      .where(eq(schema.leads.id, leadId));

  it('drops quiet unfinished leads and frees what they were holding', async () => {
    const quiet = newPhone();
    await submit('studio', quiet);
    await chat.say(quiet, 'Hi');
    await chat.tap(quiet, chat.fullDay().id);
    await chat.tap(quiet, chat.rowWith(':p_').id);
    await chat.tap(quiet, chat.rowWith(':t').id); // booked
    // A second customer who left halfway through, with a slot held by a pre-confirmation tap.
    const halfway = newPhone();
    const lead = await submit('review', halfway);
    await chat.say(halfway, 'Hi');
    await chat.tap(halfway, chat.fullDay().id);
    await chat.tap(halfway, chat.rowWith(':p_').id);
    const lastRow = chat
      .rows()
      .filter((r) => r.id.includes(':t'))
      .at(-1)!;
    await chat.tap(halfway, lastRow.id);
    const held = (
      await ctx.db.select().from(schema.bookings).where(eq(schema.bookings.leadId, lead.id))
    )[0]!;
    expect(held.status).toBe('pending');

    // A lead that is still fresh must not be touched.
    const fresh = newPhone();
    const freshLead = await submit('studio', fresh);
    await chat.say(fresh, 'Hi');

    // The booked-and-finished customer is not stale, only the unfinished one is.
    await ctx.db
      .update(schema.leads)
      .set({ status: 'in_conversation', lastInboundAt: new Date(Date.now() - 30 * 3_600_000) })
      .where(eq(schema.leads.id, lead.id));
    await age(
      (await ctx.db.select().from(schema.leads).where(eq(schema.leads.phone, quiet)))[0]!.id,
      30,
    );

    expect(await dropStaleLeads(ctx.db)).toBe(1);
    expect(await statusOf(held.id)).toBe('cancelled');
    const status = async (id: string) =>
      (await ctx.db.select().from(schema.leads).where(eq(schema.leads.id, id)))[0]!.status;
    expect(await status(lead.id)).toBe('dropped');
    expect(await status(freshLead.id)).toBe('in_conversation');
    const events = await ctx.db
      .select()
      .from(schema.leadEvents)
      .where(eq(schema.leadEvents.leadId, lead.id));
    expect(events.map((e) => e.type)).toContain('dropped');
  });
});

describe('telling the customer about a decision', () => {
  it('does not try to message them when the 24 hour window has closed', async () => {
    const { booking, lead } = await bookSlot('review');
    await ctx.db
      .update(schema.leads)
      .set({ lastInboundAt: new Date(Date.now() - 30 * 3_600_000) })
      .where(eq(schema.leads.id, lead.id));
    ctx.graph.reset();
    const res = await owner.request(`/api/bookings/${booking.id}`, {
      method: 'PATCH',
      json: { status: 'confirmed' },
    });
    expect(res.body).toMatchObject({ booking: { status: 'confirmed' }, notified: false });
    expect(ctx.graph.sent).toHaveLength(0);
  });
});
