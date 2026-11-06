import { displayAnswers, renderPlaceholders } from '@leadgen/shared';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';
import type { LeadStatus } from '../db/schema/leads.js';

export interface LeadFilters {
  status?: LeadStatus | undefined;
  campaignId?: string | undefined;
  /** Matches name or phone. */
  q?: string | undefined;
}

export async function listLeads(db: AppDb, organizationId: string, filters: LeadFilters = {}) {
  const search = filters.q?.trim();
  const rows = await db
    .select({
      lead: schema.leads,
      campaignName: schema.campaigns.name,
    })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(
      and(
        eq(schema.leads.organizationId, organizationId),
        filters.status ? eq(schema.leads.status, filters.status) : undefined,
        filters.campaignId ? eq(schema.leads.campaignId, filters.campaignId) : undefined,
        search
          ? or(
              ilike(schema.leads.name, `%${search}%`),
              ilike(schema.leads.phone, `%${search.replace(/\D/g, '') || search}%`),
            )
          : undefined,
      ),
    )
    // People waiting on a reply first, then newest.
    .orderBy(
      sql`(${schema.leads.status} = 'needs_human') desc`,
      desc(sql`coalesce(${schema.leads.lastInboundAt}, ${schema.leads.createdAt})`),
    )
    .limit(300);
  return rows.map((r) => ({
    id: r.lead.id,
    name: r.lead.name,
    phone: r.lead.phone,
    status: r.lead.status,
    source: r.lead.source,
    campaignId: r.lead.campaignId,
    campaignName: r.campaignName,
    botPaused: r.lead.botPaused,
    lastInboundAt: r.lead.lastInboundAt,
    createdAt: r.lead.createdAt,
  }));
}

/** One lead with its chat, answers and bookings. Undefined for another business's lead. */
export async function getLead(db: AppDb, organizationId: string, id: string) {
  const [row] = await db
    .select({
      lead: schema.leads,
      campaignName: schema.campaigns.name,
      businessName: schema.organization.name,
      config: schema.campaignVersions.config,
    })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .innerJoin(schema.organization, eq(schema.organization.id, schema.leads.organizationId))
    .innerJoin(
      schema.campaignVersions,
      eq(schema.campaignVersions.id, schema.leads.campaignVersionId),
    )
    .where(and(eq(schema.leads.id, id), eq(schema.leads.organizationId, organizationId)))
    .limit(1);
  if (!row) return undefined;

  const [messages, bookings] = await Promise.all([
    db
      .select({
        id: schema.messages.id,
        direction: schema.messages.direction,
        type: schema.messages.type,
        body: schema.messages.body,
        sentByUserId: schema.messages.sentByUserId,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.leadId, id))
      .orderBy(asc(schema.messages.createdAt)),
    db
      .select({
        id: schema.bookings.id,
        status: schema.bookings.status,
        startsAt: schema.bookings.startsAt,
        partySize: schema.bookings.partySize,
        resourceName: schema.resources.name,
        eventName: schema.events.name,
      })
      .from(schema.bookings)
      .leftJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
      .leftJoin(schema.events, eq(schema.events.id, schema.bookings.eventId))
      .where(eq(schema.bookings.leadId, id))
      .orderBy(asc(schema.bookings.startsAt)),
  ]);

  const labelContext = {
    name: row.lead.name,
    business: row.businessName,
    answers: displayAnswers(row.config.questions, row.lead.answers),
  };
  // Answers as the owner's question labels, in the order they were asked.
  const answers = row.config.questions
    .filter((q) => row.lead.answers[q.key] !== undefined)
    .map((q) => ({
      key: q.key,
      question: renderPlaceholders(q.prompt, labelContext),
      type: q.type,
      value: row.lead.answers[q.key],
    }));

  return {
    lead: {
      id: row.lead.id,
      name: row.lead.name,
      phone: row.lead.phone,
      status: row.lead.status,
      source: row.lead.source,
      botPaused: row.lead.botPaused,
      lastInboundAt: row.lead.lastInboundAt,
      createdAt: row.lead.createdAt,
      campaignId: row.lead.campaignId,
      campaignName: row.campaignName,
    },
    answers,
    messages,
    bookings: bookings.map((b) => ({
      id: b.id,
      status: b.status,
      startsAt: b.startsAt,
      partySize: b.partySize,
      what: b.resourceName ?? b.eventName ?? '',
    })),
  };
}
