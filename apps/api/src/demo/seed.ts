import {
  clinicExample,
  pubExample,
  restaurantExample,
  type CampaignConfig,
  type CampaignConfigInput,
} from '@leadgen/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Auth, AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';
import { createCampaign, publishCampaign } from '../services/campaigns.js';
import type { SecretBox } from '../services/crypto.js';
import { createEvent, createResource, setOfferings } from '../services/resources.js';
import { connectNumber } from '../services/whatsappNumbers.js';

const DAY = 86_400_000;
const MINUTE = 60_000;
/** The demo businesses are in India: no daylight saving, so a fixed offset is enough. */
const IST_OFFSET = 330 * MINUTE;

export const DEMO_DOMAIN = 'demo.test';
export const DEFAULT_DEMO_PASSWORD = 'demo-password-1';

export interface DemoDeps {
  auth: Auth;
  db: AppDb;
  box: SecretBox;
  /** Everyone in the demo signs in with this; defaults to a documented value. */
  password?: string | undefined;
  now?: Date | undefined;
}

export interface DemoLogin {
  business: string;
  role: string;
  email: string;
}

type Block = [startMinute: number, endMinute: number];
interface Spec {
  key: string;
  name: string;
  slug: string;
  owner: { name: string; email: string };
  phoneNumberId: string;
  displayNumber: string;
  campaign: { name: string; slug: string; draft: CampaignConfigInput };
  leads: number;
}

const SPECS: Spec[] = [
  {
    key: 'clinic',
    name: 'City Care Clinic',
    slug: 'demo-city-care',
    owner: { name: 'Dr. Meera Nair', email: `citycare@${DEMO_DOMAIN}` },
    phoneNumberId: '1000000000001',
    displayNumber: '+91 80000 11111',
    campaign: { name: 'Book an appointment', slug: 'demo-book-a-doctor', draft: clinicExample },
    leads: 90,
  },
  {
    key: 'restaurant',
    name: 'Spice Route Kitchen',
    slug: 'demo-spice-route',
    owner: { name: 'Arjun Kapoor', email: `spiceroute@${DEMO_DOMAIN}` },
    phoneNumberId: '1000000000002',
    displayNumber: '+91 80000 22222',
    campaign: { name: 'Reserve a table', slug: 'demo-book-a-table', draft: restaurantExample },
    leads: 70,
  },
  {
    key: 'pub',
    name: 'Neon Pub & Club',
    slug: 'demo-neon-pub',
    owner: { name: 'Rohan Desai', email: `neonpub@${DEMO_DOMAIN}` },
    phoneNumberId: '1000000000003',
    displayNumber: '+91 80000 33333',
    campaign: { name: 'Weekend guest list', slug: 'demo-guest-list', draft: pubExample },
    leads: 55,
  },
];

const DOCTORS = [
  { name: 'Dr. Anil Rao', email: `dr.rao@${DEMO_DOMAIN}`, hours: [[540, 780]] as Block[] },
  { name: 'Dr. Priya Shah', email: `dr.shah@${DEMO_DOMAIN}`, hours: [[540, 780]] as Block[] },
  { name: 'Dr. Kabir Iyer', email: `dr.iyer@${DEMO_DOMAIN}`, hours: [[960, 1140]] as Block[] },
];
const TABLES: Array<{ name: string; capacity: number }> = [
  { name: 'Table 1', capacity: 2 },
  { name: 'Table 2', capacity: 4 },
  { name: 'Table 3', capacity: 4 },
  { name: 'Table 4', capacity: 6 },
  { name: 'Table 5', capacity: 8 },
];
const RESTAURANT_BLOCKS: Block[] = [
  [720, 900],
  [1140, 1380],
];
const EVENT_NAMES = ['Retro Night', 'Live DJ: Kyra', 'Bollywood Saturdays', 'Ladies Night'];

const FIRST = [
  'Asha',
  'Vikram',
  'Neha',
  'Rahul',
  'Sneha',
  'Imran',
  'Divya',
  'Karan',
  'Pooja',
  'Sanjay',
  'Isha',
  'Manish',
  'Tara',
  'Faisal',
  'Anjali',
  'Dev',
];
const LAST = ['Rao', 'Mehta', 'Singh', 'Khan', 'Patel', 'Gupta', 'Nair', 'Joshi', 'Das', 'Menon'];

/** Small seeded generator: the same demo comes out every time. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The demo's people, so a reset knows exactly whom to remove. */
const demoEmails = () => [
  ...SPECS.map((s) => s.owner.email),
  `reception@${DEMO_DOMAIN}`,
  ...DOCTORS.map((d) => d.email),
];

/** Removes the demo businesses and the people created for them. Real data is untouched. */
export async function resetDemo({ db }: Pick<DemoDeps, 'db'>) {
  const orgs = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(
      inArray(
        schema.organization.slug,
        SPECS.map((s) => s.slug),
      ),
    );
  const ids = orgs.map((o) => o.id);
  if (ids.length) {
    // Bookings protect their resources, so they go first.
    await db.delete(schema.bookings).where(inArray(schema.bookings.organizationId, ids));
    await db.delete(schema.organization).where(inArray(schema.organization.id, ids));
  }
  await db.delete(schema.user).where(inArray(schema.user.email, demoEmails()));
}

async function createUser(
  { auth, db }: Pick<DemoDeps, 'auth' | 'db'>,
  input: { name: string; email: string },
  password: string,
) {
  const { user } = await auth.api.signUpEmail({ body: { ...input, password } });
  // Demo accounts skip the "verify your email" step a real sign-up would need.
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, user.id));
  return user.id;
}

/** Builds the demo from scratch: three businesses with live campaigns and a few weeks of history. */
export async function seedDemo(deps: DemoDeps): Promise<DemoLogin[]> {
  const { auth, db, box } = deps;
  const password = deps.password ?? DEFAULT_DEMO_PASSWORD;
  const now = deps.now ?? new Date();
  await resetDemo(deps);

  const logins: DemoLogin[] = [];
  for (const [index, spec] of SPECS.entries()) {
    const ownerId = await createUser(deps, spec.owner, password);
    const organization = await auth.api.createOrganization({
      body: {
        name: spec.name,
        slug: spec.slug,
        userId: ownerId,
        keepCurrentActiveOrganization: true,
      },
    });
    const orgId = organization.id;
    await db.insert(schema.businessSettings).values({
      organizationId: orgId,
      timezone: 'Asia/Kolkata',
      defaultCountryCode: '91',
    });
    logins.push({ business: spec.name, role: 'owner', email: spec.owner.email });

    const number = await connectNumber(db, box, orgId, {
      phoneNumberId: spec.phoneNumberId,
      displayNumber: spec.displayNumber,
      accessToken: 'demo-token-replace-with-a-real-one-to-send-for-real',
    });

    const resourceIds: string[] = [];
    const eventIds: string[] = [];
    const blocks = new Map<string, Block[]>();
    const slotMinutes = new Map<string, number>();

    if (spec.key === 'clinic') {
      const receptionId = await createUser(
        deps,
        { name: 'Sunita (Reception)', email: `reception@${DEMO_DOMAIN}` },
        password,
      );
      await auth.api.addMember({
        body: { userId: receptionId, role: 'manager', organizationId: orgId },
      });
      logins.push({ business: spec.name, role: 'manager', email: `reception@${DEMO_DOMAIN}` });
      for (const doctor of DOCTORS) {
        const userId = await createUser(deps, doctor, password);
        await auth.api.addMember({ body: { userId, role: 'member', organizationId: orgId } });
        logins.push({ business: spec.name, role: 'member', email: doctor.email });
        const resource = await createResource(db, orgId, {
          name: doctor.name,
          kind: 'person',
          capacity: 1,
          slotMinutes: 15,
          memberUserId: userId,
          hours: [1, 2, 3, 4, 5, 6].flatMap((weekday) =>
            doctor.hours.map(([startMinute, endMinute]) => ({ weekday, startMinute, endMinute })),
          ),
        });
        resourceIds.push(resource.id);
        blocks.set(resource.id, doctor.hours);
        slotMinutes.set(resource.id, 15);
      }
    } else if (spec.key === 'restaurant') {
      for (const table of TABLES) {
        const resource = await createResource(db, orgId, {
          name: table.name,
          kind: 'table',
          capacity: table.capacity,
          slotMinutes: 60,
          hours: [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) =>
            RESTAURANT_BLOCKS.map(([startMinute, endMinute]) => ({
              weekday,
              startMinute,
              endMinute,
            })),
          ),
        });
        resourceIds.push(resource.id);
        blocks.set(resource.id, RESTAURANT_BLOCKS);
        slotMinutes.set(resource.id, 60);
      }
    } else {
      // Fridays and Saturdays from two weeks back to three weeks ahead, doors at 9pm.
      const today = istMidnight(now);
      let n = 0;
      for (let d = -14; d <= 21; d++) {
        const day = today + d * DAY;
        const weekday = isoWeekday(day);
        if (weekday !== 5 && weekday !== 6) continue;
        const startsAt = new Date(day + 21 * 60 * MINUTE);
        const event = await createEvent(db, orgId, {
          name: EVENT_NAMES[n++ % EVENT_NAMES.length]!,
          description: 'Doors 9pm, last entry 11:30pm',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 5 * 60 * MINUTE),
          capacity: 80,
        });
        eventIds.push(event.id);
      }
    }

    const campaign = await createCampaign(db, orgId, {
      name: spec.campaign.name,
      slug: spec.campaign.slug,
      whatsappNumberId: number.id,
      draft: spec.campaign.draft,
    });
    await setOfferings(db, orgId, campaign.id, { resourceIds, eventIds });
    const published = await publishCampaign(db, orgId, campaign.id, ownerId);

    await seedHistory({
      db,
      now,
      orgId,
      campaignId: campaign.id,
      versionId: published.versionId,
      config: published.config,
      numberId: number.id,
      kind: spec.key,
      count: spec.leads,
      random: mulberry32(7 + index),
      blocks,
      slotMinutes,
      eventIds,
      businessIndex: index,
    });
  }
  return logins;
}

const istMidnight = (at: Date) => Math.floor((at.getTime() + IST_OFFSET) / DAY) * DAY - IST_OFFSET;
/** 1 = Monday ... 7 = Sunday, for the IST day starting at this instant. */
const isoWeekday = (istMidnightMs: number) =>
  ((Math.floor((istMidnightMs + IST_OFFSET) / DAY) + 3) % 7) + 1;

interface HistoryInput {
  db: AppDb;
  now: Date;
  orgId: string;
  campaignId: string;
  versionId: string;
  config: CampaignConfig;
  numberId: string;
  kind: string;
  count: number;
  random: () => number;
  blocks: Map<string, Block[]>;
  slotMinutes: Map<string, number>;
  eventIds: string[];
  businessIndex: number;
}

const BUCKETS = ['link', 'link', 'link', 'qr', 'qr', 'embed'];

/** A few weeks of leads, chats and bookings, so the dashboard has something to show. */
async function seedHistory(input: HistoryInput) {
  const { db, now, orgId, campaignId, versionId, config, random } = input;
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const questions = config.questions;
  const formQuestions = questions.filter((q) => q.channel === 'form');
  const chatQuestions = questions.filter((q) => q.channel === 'whatsapp');
  const bookingQuestionTypes = ['pick_resource', 'pick_slot', 'pick_event'];
  const eventRows = input.eventIds.length
    ? await db.select().from(schema.events).where(inArray(schema.events.id, input.eventIds))
    : [];
  const taken = new Set<string>();
  const today = istMidnight(now);

  const answerFor = (q: (typeof questions)[number]) => {
    if (q.type === 'single_choice') return pick(q.options ?? []).id;
    if (q.type === 'yes_no') return random() < 0.6;
    if (q.type === 'party_size') return 1 + Math.floor(random() * 6);
    return 'ok';
  };
  const labelFor = (q: (typeof questions)[number], value: unknown) => {
    if (q.type === 'single_choice')
      return (q.options ?? []).find((o) => o.id === value)?.label ?? '';
    if (q.type === 'yes_no') return value ? 'Yes' : 'No';
    return String(value);
  };

  for (let i = 0; i < input.count; i++) {
    // More leads recently than a few weeks ago.
    const daysAgo = Math.floor(21 * (1 - Math.sqrt(random())));
    const minuteOfDay = 9 * 60 + Math.floor(random() * 13 * 60);
    const createdAt = new Date(today - daysAgo * DAY + minuteOfDay * MINUTE);
    if (createdAt > now) continue;
    const ageHours = (now.getTime() - createdAt.getTime()) / (60 * MINUTE);

    // How far this person got: 0 = never replied, otherwise the number of chat questions done.
    const roll = random();
    const stage =
      roll < 0.12 ? 0 : roll < 0.3 ? 1 : roll < 0.4 ? 2 : roll < 0.46 ? 'human' : 'done';
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const phone = `919${input.businessIndex}${String(10_000_000 + i * 7919).slice(0, 8)}`;

    const answers: Record<string, unknown> = {};
    for (const q of formQuestions) answers[q.key] = answerFor(q);

    // Work out what happens in the chat before writing anything.
    const chat: Array<{ q: (typeof questions)[number]; value: unknown }> = [];
    const answeredChat =
      stage === 0
        ? 0
        : stage === 'human'
          ? Math.min(1, chatQuestions.length)
          : stage === 'done'
            ? chatQuestions.length
            : Math.min(stage, chatQuestions.length - 1);
    for (const q of chatQuestions.slice(0, answeredChat)) {
      const value = bookingQuestionTypes.includes(q.type) ? undefined : answerFor(q);
      if (value !== undefined) answers[q.key] = value;
      chat.push({ q, value });
    }

    // A booking only if they finished.
    let booking:
      | { resourceId?: string; eventId?: string; startsAt: Date; endsAt: Date; partySize: number }
      | undefined;
    if (stage === 'done' && config.settings.goal === 'booking') {
      const party = typeof answers.party === 'number' ? answers.party : 1;
      if (input.kind === 'pub') {
        const upcoming = eventRows
          .filter((e) => e.startsAt > createdAt)
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        const event = upcoming[Math.floor(random() * Math.min(3, upcoming.length))];
        if (event) {
          booking = {
            eventId: event.id,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            partySize: party,
          };
        }
      } else {
        const resourceIds = [...input.blocks.keys()];
        for (let attempt = 0; attempt < 12 && !booking; attempt++) {
          const resourceId = pick(resourceIds);
          const dayStart = istMidnight(createdAt) + (1 + Math.floor(random() * 5)) * DAY;
          if (isoWeekday(dayStart) === 7 && input.kind === 'clinic') continue;
          const [from, to] = pick(input.blocks.get(resourceId)!);
          const length = input.slotMinutes.get(resourceId)!;
          const slots = Math.floor((to - from) / length);
          const startsAt = new Date(
            dayStart + (from + length * Math.floor(random() * slots)) * MINUTE,
          );
          const key = `${resourceId}|${startsAt.toISOString()}`;
          if (taken.has(key)) continue;
          taken.add(key);
          booking = {
            resourceId,
            startsAt,
            endsAt: new Date(startsAt.getTime() + length * MINUTE),
            partySize: party,
          };
        }
      }
    }

    const finished = stage === 'done' && (config.settings.goal !== 'booking' || !!booking);
    const status = finished
      ? 'completed'
      : stage === 'human' && ageHours < 72
        ? 'needs_human'
        : ageHours < 24
          ? stage === 0
            ? 'new'
            : 'in_conversation'
          : 'dropped';

    const [lead] = await db
      .insert(schema.leads)
      .values({
        organizationId: orgId,
        campaignId,
        campaignVersionId: versionId,
        name,
        phone,
        source: pick(BUCKETS),
        answers: answers as never,
        status,
        botPaused: status === 'needs_human',
        currentQuestionId:
          status === 'in_conversation' || status === 'needs_human'
            ? (chatQuestions[answeredChat]?.id ?? null)
            : null,
        lastInboundAt: stage === 0 ? null : new Date(createdAt.getTime() + 3 * MINUTE),
        createdAt,
        updatedAt: new Date(createdAt.getTime() + (stage === 0 ? 0 : 12) * MINUTE),
      })
      .returning({ id: schema.leads.id });
    const leadId = lead!.id;

    // The funnel.
    const at = (minutes: number) => new Date(createdAt.getTime() + minutes * MINUTE);
    const events: Array<typeof schema.leadEvents.$inferInsert> = [
      { leadId, campaignId, type: 'submitted', at: createdAt },
    ];
    if (stage !== 0) events.push({ leadId, campaignId, type: 'first_reply', at: at(3) });
    chat.forEach(({ q }, k) =>
      events.push({ leadId, campaignId, type: 'answered', questionId: q.id, at: at(4 + k) }),
    );
    if (stage === 'human') events.push({ leadId, campaignId, type: 'handoff', at: at(6) });
    if (finished) {
      if (booking) events.push({ leadId, campaignId, type: 'booked', at: at(10) });
      events.push({ leadId, campaignId, type: 'completed', at: at(11) });
    }
    if (status === 'dropped') {
      events.push({ leadId, campaignId, type: 'dropped', at: at(24 * 60) });
    }
    await db.insert(schema.leadEvents).values(events);

    // The chat, kept simple: the opening message, then each question and answer.
    const lines: Array<{ out: boolean; type: string; body: Record<string, unknown>; min: number }> =
      [
        {
          out: true,
          type: 'template',
          body: { kind: 'template', name: 'hello_world', language: 'en_US' },
          min: 0,
        },
      ];
    if (stage !== 0) {
      lines.push({ out: false, type: 'text', body: { kind: 'text', body: 'Hi' }, min: 3 });
      chat.forEach(({ q, value }, k) => {
        lines.push({
          out: true,
          type: 'text',
          body: { kind: 'text', body: q.prompt.replace('{{business}}', '') },
          min: 4 + k,
        });
        lines.push({
          out: false,
          type: 'reply',
          body: {
            kind: 'reply',
            id: `${q.id}:x`,
            title: value === undefined ? 'Done' : labelFor(q, value),
          },
          min: 5 + k,
        });
      });
      if (stage === 'human') {
        lines.push({
          out: false,
          type: 'text',
          body: { kind: 'text', body: 'Can I talk to someone please?' },
          min: 6,
        });
      } else if (finished) {
        lines.push({
          out: true,
          type: 'text',
          body: { kind: 'text', body: `Thanks ${name.split(' ')[0]}, you're all set.` },
          min: 11,
        });
      }
    }
    await db.insert(schema.messages).values(
      lines.map((l, k) => ({
        organizationId: orgId,
        leadId,
        whatsappNumberId: input.numberId,
        waMessageId: `demo.${leadId}.${k}`,
        phone,
        direction: l.out ? ('out' as const) : ('in' as const),
        type: l.type,
        body: l.body,
        deliveryStatus: l.out ? 'read' : null,
        channel: 'whatsapp' as const,
        createdAt: at(l.min),
      })),
    );

    if (booking) {
      const past = booking.startsAt < now;
      const outcome = random();
      await db.insert(schema.bookings).values({
        organizationId: orgId,
        leadId,
        resourceId: booking.resourceId ?? null,
        eventId: booking.eventId ?? null,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        partySize: booking.partySize,
        status:
          outcome < 0.08
            ? 'cancelled'
            : past
              ? outcome < 0.2
                ? 'no_show'
                : 'completed'
              : 'confirmed',
        createdAt: at(10),
      });
    }
  }
}
