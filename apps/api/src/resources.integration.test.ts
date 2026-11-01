import { leadExample } from '@leadgen/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBusinessWithOwner, createTestContext, type TestContext } from './test/helpers.js';

let ctx: TestContext;
let a: Awaited<ReturnType<typeof createBusinessWithOwner>>;
let b: Awaited<ReturnType<typeof createBusinessWithOwner>>;

const MON_TO_FRI = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}));

beforeAll(async () => {
  ctx = await createTestContext();
  a = await createBusinessWithOwner(ctx, 'Alpha Clinic', 'owner@alpha.test');
  b = await createBusinessWithOwner(ctx, 'Beta Cafe', 'owner@beta.test');
});

afterAll(() => ctx.close());

const resource = (over: Record<string, unknown> = {}) => ({
  name: 'Dr. Rao',
  kind: 'person',
  capacity: 1,
  slotMinutes: 30,
  hours: MON_TO_FRI,
  ...over,
});

describe('resources', () => {
  let id: string;

  it('creates a resource with weekly hours and lists them sorted', async () => {
    const res = await a.owner.request('/api/resources', { json: resource() });
    expect(res.status).toBe(201);
    id = res.body.resource.id;
    const list = await a.owner.request('/api/resources');
    expect(list.body.resources).toHaveLength(1);
    expect(list.body.resources[0].hours.map((h: { weekday: number }) => h.weekday)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('rejects bad hours', async () => {
    const bad = async (hours: unknown[]) =>
      (await a.owner.request('/api/resources', { json: resource({ hours }) })).status;
    expect(await bad([{ weekday: 8, startMinute: 0, endMinute: 60 }])).toBe(400);
    expect(await bad([{ weekday: 1, startMinute: 600, endMinute: 600 }])).toBe(422);
    expect(await bad([{ weekday: 1, startMinute: 700, endMinute: 600 }])).toBe(422);
    expect(
      await bad([
        { weekday: 1, startMinute: 540, endMinute: 720 },
        { weekday: 1, startMinute: 700, endMinute: 800 },
      ]),
    ).toBe(422);
  });

  it('allows split shifts on one day', async () => {
    const res = await a.owner.request('/api/resources', {
      json: resource({
        name: 'Split',
        hours: [
          { weekday: 1, startMinute: 540, endMinute: 720 },
          { weekday: 1, startMinute: 780, endMinute: 1020 },
        ],
      }),
    });
    expect(res.status).toBe(201);
  });

  it('replaces hours on update and keeps the rest', async () => {
    const res = await a.owner.request(`/api/resources/${id}`, {
      method: 'PATCH',
      json: { slotMinutes: 20, hours: [{ weekday: 6, startMinute: 600, endMinute: 660 }] },
    });
    expect(res.status).toBe(200);
    const [row] = (await a.owner.request('/api/resources')).body.resources.filter(
      (r: { id: string }) => r.id === id,
    );
    expect(row).toMatchObject({ name: 'Dr. Rao', slotMinutes: 20, hours: [{ weekday: 6 }] });
  });

  it('only links staff who belong to the business', async () => {
    const stranger = await ctx.auth.api.signUpEmail({
      body: { name: 'Stranger', email: 'stranger@x.test', password: 'stranger-test-pass' },
    });
    const res = await a.owner.request(`/api/resources/${id}`, {
      method: 'PATCH',
      json: { memberUserId: stranger.user.id },
    });
    expect(res.status).toBe(422);
  });

  it('keeps businesses apart', async () => {
    expect((await b.owner.request('/api/resources')).body.resources).toEqual([]);
    expect(
      (await b.owner.request(`/api/resources/${id}`, { method: 'PATCH', json: { name: 'x' } }))
        .status,
    ).toBe(404);
    expect((await b.owner.request(`/api/resources/${id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('manages time off', async () => {
    const add = await a.owner.request(`/api/resources/${id}/time-off`, {
      json: { startsAt: '2026-12-24T00:00:00Z', endsAt: '2026-12-26T00:00:00Z', reason: 'Holiday' },
    });
    expect(add.status).toBe(201);
    const backwards = await a.owner.request(`/api/resources/${id}/time-off`, {
      json: { startsAt: '2026-12-26T00:00:00Z', endsAt: '2026-12-24T00:00:00Z' },
    });
    expect(backwards.status).toBe(422);
    const [row] = (await a.owner.request('/api/resources')).body.resources.filter(
      (r: { id: string }) => r.id === id,
    );
    expect(row.timeOff).toHaveLength(1);
    const del = await a.owner.request(`/api/resources/${id}/time-off/${add.body.timeOff.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
  });

  it('deletes an unused resource', async () => {
    const created = await a.owner.request('/api/resources', { json: resource({ name: 'Temp' }) });
    expect(
      (await a.owner.request(`/api/resources/${created.body.resource.id}`, { method: 'DELETE' }))
        .status,
    ).toBe(204);
  });
});

describe('events', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    name: 'DJ Night',
    startsAt: '2026-12-20T16:30:00Z',
    endsAt: '2026-12-20T21:30:00Z',
    capacity: 120,
    ...over,
  });

  it('creates, lists in date order, updates and deletes', async () => {
    const later = await a.owner.request('/api/events', {
      json: event({
        name: 'Later',
        startsAt: '2027-01-01T10:00:00Z',
        endsAt: '2027-01-01T12:00:00Z',
      }),
    });
    const sooner = await a.owner.request('/api/events', { json: event() });
    expect(later.status).toBe(201);
    const list = await a.owner.request('/api/events');
    expect(list.body.events.map((e: { name: string }) => e.name)).toEqual(['DJ Night', 'Later']);

    const patch = await a.owner.request(`/api/events/${sooner.body.event.id}`, {
      method: 'PATCH',
      json: { capacity: 80 },
    });
    expect(patch.body.event.capacity).toBe(80);
    expect(
      (await a.owner.request(`/api/events/${later.body.event.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
  });

  it('rejects an event that ends before it starts, also on update', async () => {
    expect(
      (await a.owner.request('/api/events', { json: event({ endsAt: '2026-12-20T10:00:00Z' }) }))
        .status,
    ).toBe(422);
    const list = await a.owner.request('/api/events');
    const patch = await a.owner.request(`/api/events/${list.body.events[0].id}`, {
      method: 'PATCH',
      json: { endsAt: '2020-01-01T00:00:00Z' },
    });
    expect(patch.status).toBe(422);
  });

  it('keeps events private to their business', async () => {
    expect((await b.owner.request('/api/events')).body.events).toEqual([]);
  });
});

describe('what a campaign offers', () => {
  it('sets, reads and replaces offerings, and refuses other businesses things', async () => {
    const campaign = await a.owner.request('/api/campaigns', {
      json: { name: 'Visits', draft: leadExample },
    });
    const cid = campaign.body.campaign.id;
    const r = (await a.owner.request('/api/resources')).body.resources[0].id;
    const e = (await a.owner.request('/api/events')).body.events[0].id;

    const set = await a.owner.request(`/api/campaigns/${cid}/offerings`, {
      method: 'PUT',
      json: { resourceIds: [r], eventIds: [e] },
    });
    expect(set.body).toEqual({ resourceIds: [r], eventIds: [e] });
    expect((await a.owner.request(`/api/campaigns/${cid}/offerings`)).body).toEqual({
      resourceIds: [r],
      eventIds: [e],
    });

    await a.owner.request(`/api/campaigns/${cid}/offerings`, {
      method: 'PUT',
      json: { resourceIds: [], eventIds: [] },
    });
    expect((await a.owner.request(`/api/campaigns/${cid}/offerings`)).body).toEqual({
      resourceIds: [],
      eventIds: [],
    });

    const foreign = await b.owner.request('/api/campaigns', {
      json: { name: 'Mine', draft: leadExample },
    });
    const steal = await b.owner.request(`/api/campaigns/${foreign.body.campaign.id}/offerings`, {
      method: 'PUT',
      json: { resourceIds: [r], eventIds: [] },
    });
    expect(steal.status).toBe(422);
    expect((await b.owner.request(`/api/campaigns/${cid}/offerings`)).status).toBe(404);
    expect(
      (
        await b.owner.request(`/api/campaigns/${cid}/offerings`, {
          method: 'PUT',
          json: { resourceIds: [], eventIds: [] },
        })
      ).status,
    ).toBe(404);
  });
});
