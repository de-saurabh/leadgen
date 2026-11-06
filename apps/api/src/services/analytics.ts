import { and, eq, sql } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';

export interface AnalyticsFilters {
  from: Date;
  to: Date;
  campaignId?: string | undefined;
}

interface Counts {
  leads: number;
  replied: number;
  completed: number;
  booked: number;
  handedOff: number;
  dropped: number;
}

const zero = (): Counts => ({
  leads: 0,
  replied: 0,
  completed: 0,
  booked: 0,
  handedOff: 0,
  dropped: 0,
});

const KEYS: Array<keyof Counts> = [
  'leads',
  'replied',
  'completed',
  'booked',
  'handedOff',
  'dropped',
];

function add(into: Counts, row: Counts) {
  for (const key of KEYS) into[key] += row[key];
}

/**
 * What the owner wants to know: how many people came in, how far they got, where they came
 * from and where they gave up. Counted per lead, so a lead that does a thing twice counts once.
 */
export async function loadAnalytics(db: AppDb, organizationId: string, filters: AnalyticsFilters) {
  const [settings] = await db
    .select({ timezone: schema.businessSettings.timezone })
    .from(schema.businessSettings)
    .where(eq(schema.businessSettings.organizationId, organizationId));
  const timeZone = settings?.timezone ?? 'UTC';

  const leadScope = and(
    eq(schema.leads.organizationId, organizationId),
    sql`${schema.leads.createdAt} >= ${filters.from}`,
    sql`${schema.leads.createdAt} < ${filters.to}`,
    filters.campaignId ? eq(schema.leads.campaignId, filters.campaignId) : undefined,
  );

  const grouped = await db
    .select({
      campaignId: schema.leads.campaignId,
      campaignName: schema.campaigns.name,
      source: schema.leads.source,
      leads: sql<number>`count(*)::int`,
      replied: sql<number>`count(*) filter (where exists (select 1 from messages m where m.lead_id = ${schema.leads.id} and m.direction = 'in'))::int`,
      completed: sql<number>`count(*) filter (where ${schema.leads.status} = 'completed')::int`,
      booked: sql<number>`count(*) filter (where exists (select 1 from bookings b where b.lead_id = ${schema.leads.id} and b.status in ('pending','confirmed','completed','no_show')))::int`,
      handedOff: sql<number>`count(*) filter (where exists (select 1 from lead_events e where e.lead_id = ${schema.leads.id} and e.type = 'handoff'))::int`,
      dropped: sql<number>`count(*) filter (where ${schema.leads.status} = 'dropped')::int`,
    })
    .from(schema.leads)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(leadScope)
    .groupBy(schema.leads.campaignId, schema.campaigns.name, schema.leads.source);

  const totals = zero();
  const byCampaign = new Map<string, Counts & { id: string; name: string }>();
  const bySource = new Map<string, Counts & { source: string }>();
  for (const row of grouped) {
    add(totals, row);
    const campaign = byCampaign.get(row.campaignId) ?? {
      ...zero(),
      id: row.campaignId,
      name: row.campaignName,
    };
    add(campaign, row);
    byCampaign.set(row.campaignId, campaign);
    const source = bySource.get(row.source) ?? { ...zero(), source: row.source };
    add(source, row);
    bySource.set(row.source, source);
  }

  const days = await db
    .select({
      day: sql<string>`to_char((${schema.leads.createdAt} at time zone ${timeZone})::date, 'YYYY-MM-DD')`,
      leads: sql<number>`count(*)::int`,
    })
    .from(schema.leads)
    .where(leadScope)
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  // Where people stop: how many answered each WhatsApp question of one campaign.
  let dropOff: Array<{ id: string; prompt: string; answered: number }> | undefined;
  if (filters.campaignId) {
    const [campaign] = await db
      .select({ config: schema.campaignVersions.config })
      .from(schema.campaigns)
      .innerJoin(
        schema.campaignVersions,
        eq(schema.campaignVersions.id, schema.campaigns.publishedVersionId),
      )
      .where(
        and(
          eq(schema.campaigns.id, filters.campaignId),
          eq(schema.campaigns.organizationId, organizationId),
        ),
      );
    if (campaign) {
      const answered = await db
        .select({
          questionId: schema.leadEvents.questionId,
          n: sql<number>`count(distinct ${schema.leadEvents.leadId})::int`,
        })
        .from(schema.leadEvents)
        .innerJoin(schema.leads, eq(schema.leads.id, schema.leadEvents.leadId))
        .where(and(leadScope, eq(schema.leadEvents.type, 'answered')))
        .groupBy(schema.leadEvents.questionId);
      dropOff = campaign.config.questions
        .filter((q) => q.channel === 'whatsapp')
        .map((q) => ({
          id: q.id,
          prompt: q.prompt,
          answered: answered.find((a) => a.questionId === q.id)?.n ?? 0,
        }));
    }
  }

  return {
    timeZone,
    totals,
    byCampaign: [...byCampaign.values()].sort((a, b) => b.leads - a.leads),
    bySource: [...bySource.values()].sort((a, b) => b.leads - a.leads),
    perDay: days,
    dropOff,
  };
}
