import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';

export class ResourceError extends Error {
  constructor(
    public readonly code: 'not_found' | 'invalid' | 'in_use',
    message: string,
  ) {
    super(message);
  }
}

export interface HoursInput {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** Throws when hours are out of range or overlap on the same day. */
export function checkHours(hours: readonly HoursInput[]) {
  for (const h of hours) {
    if (!Number.isInteger(h.weekday) || h.weekday < 1 || h.weekday > 7) {
      throw new ResourceError('invalid', 'Weekday must be 1 (Monday) to 7 (Sunday)');
    }
    if (h.startMinute < 0 || h.endMinute > 24 * 60 || h.startMinute >= h.endMinute) {
      throw new ResourceError('invalid', 'Each opening time must end after it starts');
    }
  }
  const byDay = new Map<number, HoursInput[]>();
  for (const h of hours) byDay.set(h.weekday, [...(byDay.get(h.weekday) ?? []), h]);
  for (const day of byDay.values()) {
    const sorted = [...day].sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.startMinute < sorted[i - 1]!.endMinute) {
        throw new ResourceError('invalid', 'Opening times on the same day overlap');
      }
    }
  }
}

export interface ResourceInput {
  name: string;
  kind: schema.ResourceKind;
  capacity: number;
  slotMinutes: number;
  memberUserId?: string | null | undefined;
  active?: boolean | undefined;
  hours?: HoursInput[] | undefined;
}

async function checkMember(db: AppDb, organizationId: string, userId: string | null | undefined) {
  if (!userId) return;
  const [row] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!row) throw new ResourceError('invalid', 'That person is not part of this business');
}

export async function listResources(db: AppDb, organizationId: string) {
  const rows = await db
    .select()
    .from(schema.resources)
    .where(eq(schema.resources.organizationId, organizationId))
    .orderBy(asc(schema.resources.name));
  const ids = rows.map((r) => r.id);
  const [hours, timeOff] = ids.length
    ? await Promise.all([
        db.select().from(schema.resourceHours).where(inArray(schema.resourceHours.resourceId, ids)),
        db
          .select()
          .from(schema.resourceTimeOff)
          .where(inArray(schema.resourceTimeOff.resourceId, ids))
          .orderBy(asc(schema.resourceTimeOff.startsAt)),
      ])
    : [[], []];
  return rows.map((r) => ({
    ...r,
    hours: hours
      .filter((h) => h.resourceId === r.id)
      .map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute }))
      .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
    timeOff: timeOff.filter((t) => t.resourceId === r.id),
  }));
}

async function ownedResource(db: AppDb, organizationId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.resources)
    .where(and(eq(schema.resources.id, id), eq(schema.resources.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new ResourceError('not_found', 'resource not found');
  return row;
}

export async function createResource(db: AppDb, organizationId: string, input: ResourceInput) {
  if (input.hours) checkHours(input.hours);
  await checkMember(db, organizationId, input.memberUserId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.resources)
      .values({
        organizationId,
        name: input.name,
        kind: input.kind,
        capacity: input.capacity,
        slotMinutes: input.slotMinutes,
        memberUserId: input.memberUserId ?? null,
        active: input.active ?? true,
      })
      .returning();
    if (input.hours?.length) {
      await tx
        .insert(schema.resourceHours)
        .values(input.hours.map((h) => ({ ...h, resourceId: row!.id })));
    }
    return row!;
  });
}

export async function updateResource(
  db: AppDb,
  organizationId: string,
  id: string,
  patch: Partial<ResourceInput>,
) {
  await ownedResource(db, organizationId, id);
  if (patch.hours) checkHours(patch.hours);
  if (patch.memberUserId !== undefined) await checkMember(db, organizationId, patch.memberUserId);
  const { hours, ...fields } = patch;
  return db.transaction(async (tx) => {
    const [row] = Object.keys(fields).length
      ? await tx.update(schema.resources).set(fields).where(eq(schema.resources.id, id)).returning()
      : await tx.select().from(schema.resources).where(eq(schema.resources.id, id));
    if (hours) {
      await tx.delete(schema.resourceHours).where(eq(schema.resourceHours.resourceId, id));
      if (hours.length) {
        await tx.insert(schema.resourceHours).values(hours.map((h) => ({ ...h, resourceId: id })));
      }
    }
    return row!;
  });
}

export async function deleteResource(db: AppDb, organizationId: string, id: string) {
  await ownedResource(db, organizationId, id);
  const [booked] = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(eq(schema.bookings.resourceId, id))
    .limit(1);
  if (booked) {
    throw new ResourceError('in_use', 'It has bookings. Turn it off instead of deleting it.');
  }
  await db.delete(schema.resources).where(eq(schema.resources.id, id));
}

export async function addTimeOff(
  db: AppDb,
  organizationId: string,
  resourceId: string,
  input: { startsAt: Date; endsAt: Date; reason?: string | undefined },
) {
  await ownedResource(db, organizationId, resourceId);
  if (input.endsAt <= input.startsAt) {
    throw new ResourceError('invalid', 'Time off must end after it starts');
  }
  const [row] = await db
    .insert(schema.resourceTimeOff)
    .values({ resourceId, ...input, reason: input.reason ?? null })
    .returning();
  return row!;
}

export async function removeTimeOff(
  db: AppDb,
  organizationId: string,
  resourceId: string,
  timeOffId: string,
) {
  await ownedResource(db, organizationId, resourceId);
  const removed = await db
    .delete(schema.resourceTimeOff)
    .where(
      and(
        eq(schema.resourceTimeOff.id, timeOffId),
        eq(schema.resourceTimeOff.resourceId, resourceId),
      ),
    )
    .returning({ id: schema.resourceTimeOff.id });
  if (removed.length === 0) throw new ResourceError('not_found', 'time off not found');
}

export interface EventInput {
  name: string;
  description?: string | null | undefined;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  active?: boolean | undefined;
}

export function listEvents(db: AppDb, organizationId: string) {
  return db
    .select()
    .from(schema.events)
    .where(eq(schema.events.organizationId, organizationId))
    .orderBy(asc(schema.events.startsAt));
}

export async function createEvent(db: AppDb, organizationId: string, input: EventInput) {
  if (input.endsAt <= input.startsAt) {
    throw new ResourceError('invalid', 'The event must end after it starts');
  }
  const [row] = await db
    .insert(schema.events)
    .values({
      organizationId,
      name: input.name,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      active: input.active ?? true,
    })
    .returning();
  return row!;
}

export async function updateEvent(
  db: AppDb,
  organizationId: string,
  id: string,
  patch: Partial<EventInput>,
) {
  const [current] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, id), eq(schema.events.organizationId, organizationId)))
    .limit(1);
  if (!current) throw new ResourceError('not_found', 'event not found');
  const startsAt = patch.startsAt ?? current.startsAt;
  const endsAt = patch.endsAt ?? current.endsAt;
  if (endsAt <= startsAt) throw new ResourceError('invalid', 'The event must end after it starts');
  const [row] = await db
    .update(schema.events)
    .set(patch)
    .where(eq(schema.events.id, id))
    .returning();
  return row!;
}

export async function deleteEvent(db: AppDb, organizationId: string, id: string) {
  const [current] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(and(eq(schema.events.id, id), eq(schema.events.organizationId, organizationId)))
    .limit(1);
  if (!current) throw new ResourceError('not_found', 'event not found');
  const [booked] = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(eq(schema.bookings.eventId, id))
    .limit(1);
  if (booked)
    throw new ResourceError('in_use', 'It has bookings. Turn it off instead of deleting it.');
  await db.delete(schema.events).where(eq(schema.events.id, id));
}

async function ownedCampaign(db: AppDb, organizationId: string, campaignId: string) {
  const [campaign] = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.organizationId, organizationId)),
    )
    .limit(1);
  if (!campaign) throw new ResourceError('not_found', 'campaign not found');
}

/** What a campaign offers customers. */
export async function getOfferings(db: AppDb, organizationId: string, campaignId: string) {
  await ownedCampaign(db, organizationId, campaignId);
  const [resourceRows, eventRows] = await Promise.all([
    db
      .select({ id: schema.campaignResources.resourceId })
      .from(schema.campaignResources)
      .where(eq(schema.campaignResources.campaignId, campaignId)),
    db
      .select({ id: schema.campaignEvents.eventId })
      .from(schema.campaignEvents)
      .where(eq(schema.campaignEvents.campaignId, campaignId)),
  ]);
  return { resourceIds: resourceRows.map((r) => r.id), eventIds: eventRows.map((r) => r.id) };
}

/** Replaces what a campaign offers. Everything must belong to the same business. */
export async function setOfferings(
  db: AppDb,
  organizationId: string,
  campaignId: string,
  input: { resourceIds: string[]; eventIds: string[] },
) {
  await ownedCampaign(db, organizationId, campaignId);

  const resourceIds = [...new Set(input.resourceIds)];
  const eventIds = [...new Set(input.eventIds)];
  if (resourceIds.length) {
    const owned = await db
      .select({ id: schema.resources.id })
      .from(schema.resources)
      .where(
        and(
          eq(schema.resources.organizationId, organizationId),
          inArray(schema.resources.id, resourceIds),
        ),
      );
    if (owned.length !== resourceIds.length) throw new ResourceError('invalid', 'Unknown resource');
  }
  if (eventIds.length) {
    const owned = await db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(
        and(eq(schema.events.organizationId, organizationId), inArray(schema.events.id, eventIds)),
      );
    if (owned.length !== eventIds.length) throw new ResourceError('invalid', 'Unknown event');
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.campaignResources)
      .where(eq(schema.campaignResources.campaignId, campaignId));
    await tx.delete(schema.campaignEvents).where(eq(schema.campaignEvents.campaignId, campaignId));
    if (resourceIds.length) {
      await tx
        .insert(schema.campaignResources)
        .values(resourceIds.map((resourceId) => ({ campaignId, resourceId })));
    }
    if (eventIds.length) {
      await tx
        .insert(schema.campaignEvents)
        .values(eventIds.map((eventId) => ({ campaignId, eventId })));
    }
  });
  return { resourceIds, eventIds };
}
