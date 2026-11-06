import { renderPlaceholders, displayAnswers, type InboundMessage } from '@leadgen/shared';
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';
import { formatDay, formatTime } from '../bookings/time.js';
import { CAPACITY_STATUSES, type BookingStatus } from '../db/schema/booking.js';
import { cancelConfirmation, changeButtons, intentOf } from '../engine/aftercare.js';
import { advance } from '../engine/engine.js';
import { createBookingPort } from './booking.js';
import type { Logger } from '../logger.js';
import type { GraphClient, SendableMessage } from '../whatsapp/graph.js';
import type { ParsedInbound, ParsedWebhook } from '../whatsapp/webhook.js';
import type { SecretBox } from './crypto.js';
import type { EventBus } from './events.js';
import { createDelivery, windowOpen, type NumberRow } from './delivery.js';

type LeadRow = typeof schema.leads.$inferSelect;

export interface ConversationDeps {
  db: AppDb;
  box: SecretBox;
  graph: GraphClient;
  logger: Logger;
  templateMode: 'test' | 'live';
  /** Queues the reminders for a confirmed booking. */
  scheduleReminders?: ((bookingId: string) => Promise<unknown>) | undefined;
  /** Tells open dashboards that something changed. */
  bus?: EventBus | undefined;
}

export class LeadError extends Error {
  constructor(
    public readonly code: 'not_found' | 'window_closed' | 'bad_state',
    message: string,
  ) {
    super(message);
  }
}

/** Statuses in which an incoming message still belongs to a lead's conversation. */
const OPEN_STATUSES = ['new', 'in_conversation', 'needs_human'] as const;

const TEST_TEMPLATE = { name: 'hello_world', language: 'en_US' } as const;

export function createConversationService({
  db,
  box,
  graph,
  logger,
  templateMode,
  scheduleReminders: scheduleReminderJobs,
  bus,
}: ConversationDeps) {
  const deliver = createDelivery({ box, graph });

  async function findOpenLead(number: NumberRow, from: string): Promise<LeadRow | undefined> {
    const [row] = await db
      .select({ lead: schema.leads })
      .from(schema.leads)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
      .where(
        and(
          eq(schema.leads.organizationId, number.organizationId),
          eq(schema.campaigns.whatsappNumberId, number.id),
          inArray(schema.leads.status, OPEN_STATUSES),
          // Tolerates a missing or different country-code prefix.
          sql`right(${schema.leads.phone}, 10) = right(${from}, 10)`,
        ),
      )
      .orderBy(sql`${schema.leads.createdAt} desc`)
      .limit(1);
    return row?.lead;
  }

  /** A finished lead whose next booking the customer may want to change. */
  async function findUpcomingBooking(number: NumberRow, from: string) {
    const [row] = await db
      .select({ lead: schema.leads, booking: schema.bookings })
      .from(schema.bookings)
      .innerJoin(schema.leads, eq(schema.leads.id, schema.bookings.leadId))
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
      .where(
        and(
          eq(schema.leads.organizationId, number.organizationId),
          eq(schema.campaigns.whatsappNumberId, number.id),
          eq(schema.leads.status, 'completed'),
          inArray(schema.bookings.status, [...CAPACITY_STATUSES]),
          gt(schema.bookings.startsAt, new Date()),
          sql`right(${schema.leads.phone}, 10) = right(${from}, 10)`,
        ),
      )
      .orderBy(asc(schema.bookings.startsAt))
      .limit(1);
    return row;
  }

  type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

  async function loadContext(tx: Tx, lead: LeadRow) {
    const [row] = await tx
      .select({
        config: schema.campaignVersions.config,
        businessName: schema.organization.name,
        timeZone: schema.businessSettings.timezone,
      })
      .from(schema.campaignVersions)
      .innerJoin(schema.organization, eq(schema.organization.id, lead.organizationId))
      .innerJoin(
        schema.businessSettings,
        eq(schema.businessSettings.organizationId, lead.organizationId),
      )
      .where(eq(schema.campaignVersions.id, lead.campaignVersionId));
    if (!row) throw new Error(`campaign version ${lead.campaignVersionId} is missing`);
    return row;
  }

  /**
   * Runs the engine for one customer message, sends what it says and saves the new state.
   * Sending comes first: if WhatsApp refuses, the whole step rolls back and the customer's
   * next message is handled from where they were.
   */
  async function converse(
    tx: Tx,
    number: NumberRow,
    lead: LeadRow,
    context: Awaited<ReturnType<typeof loadContext>>,
    message: InboundMessage,
  ): Promise<{ newBooking?: { id: string; status: string } }> {
    const result = await advance({
      lead: {
        name: lead.name,
        status: lead.status,
        answers: lead.answers,
        currentQuestionId: lead.currentQuestionId,
        flowState: lead.flowState,
      },
      config: context.config,
      businessName: context.businessName,
      message,
      booking: createBookingPort(tx, {
        organizationId: lead.organizationId,
        campaignId: lead.campaignId,
        leadId: lead.id,
        timeZone: context.timeZone,
        countPartySize: context.config.settings.countPartySize,
        requiresApproval: context.config.settings.requiresApproval,
      }),
    });
    await deliver(tx, number, lead, result.outbound);

    const flow = result.lead.flowState as {
      reschedulingBookingId?: string;
      booking?: { id: string; status: string };
    };
    const booked = result.events.some((e) => e.type === 'booked') ? flow.booking : undefined;
    if (booked && flow.reschedulingBookingId) {
      // The new time is secured, so the old one is released.
      await tx
        .update(schema.bookings)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(schema.bookings.id, flow.reschedulingBookingId),
            inArray(schema.bookings.status, [...CAPACITY_STATUSES]),
          ),
        );
      await tx
        .update(schema.bookings)
        .set({ rescheduledFromId: flow.reschedulingBookingId })
        .where(eq(schema.bookings.id, booked.id));
      delete flow.reschedulingBookingId;
    }

    await tx
      .update(schema.leads)
      .set({
        status: result.lead.status,
        answers: result.lead.answers,
        currentQuestionId: result.lead.currentQuestionId,
        flowState: result.lead.flowState,
        botPaused: result.lead.botPaused,
      })
      .where(eq(schema.leads.id, lead.id));
    if (result.events.length > 0) {
      await tx.insert(schema.leadEvents).values(
        result.events.map((e) => ({
          leadId: lead.id,
          campaignId: lead.campaignId,
          type: e.type,
          questionId: e.questionId ?? null,
        })),
      );
    }
    return booked ? { newBooking: booked } : {};
  }

  /** Reminders are queued after the booking is committed, and a failure here never loses it. */
  async function scheduleReminders(bookingId: string) {
    try {
      await scheduleReminderJobs?.(bookingId);
    } catch (err) {
      logger.error({ err, bookingId }, 'could not schedule reminders');
    }
  }

  /** A customer with a finished booking writes in: cancel it, move it, or just ask. */
  async function handleAftercare(
    number: NumberRow,
    m: ParsedInbound,
    storedId: string,
  ): Promise<string | undefined> {
    const found = await findUpcomingBooking(number, m.from);
    if (!found) return undefined;
    await db
      .update(schema.messages)
      .set({ leadId: found.lead.id })
      .where(eq(schema.messages.id, storedId));
    await db
      .update(schema.leads)
      .set({ lastInboundAt: new Date() })
      .where(eq(schema.leads.id, found.lead.id));

    const intent = intentOf(m.message);
    let newBooking: { id: string; status: string } | undefined;

    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${found.lead.id}, 0))`);
      const [lead] = await tx.select().from(schema.leads).where(eq(schema.leads.id, found.lead.id));
      const [booking] = await tx
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, found.booking.id));
      // Someone may have acted in the meantime.
      if (!lead || lead.status !== 'completed' || !booking) return;
      if (!CAPACITY_STATUSES.includes(booking.status as (typeof CAPACITY_STATUSES)[number])) return;

      const context = await loadContext(tx, lead);
      const [what] = await tx
        .select({ resource: schema.resources.name, event: schema.events.name })
        .from(schema.bookings)
        .leftJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
        .leftJoin(schema.events, eq(schema.events.id, schema.bookings.eventId))
        .where(eq(schema.bookings.id, booking.id));
      const summary = `${what?.resource ?? what?.event ?? 'your booking'} on ${formatDay(booking.startsAt, context.timeZone)} at ${formatTime(booking.startsAt, context.timeZone)}`;
      const say = (body: string) => deliver(tx, number, lead, [{ kind: 'text', body }]);

      switch (intent) {
        case 'cancel':
          await deliver(tx, number, lead, [cancelConfirmation(`Cancel ${summary}?`)]);
          return;
        case 'keep':
          await say('Great, your booking is still on.');
          return;
        case 'cancel_yes':
          await tx
            .update(schema.bookings)
            .set({ status: 'cancelled' })
            .where(eq(schema.bookings.id, booking.id));
          await say(`Your booking for ${summary} has been cancelled.`);
          return;
        case 'reschedule': {
          const pick = context.config.questions.find(
            (q) => q.type === 'pick_slot' || q.type === 'pick_event',
          );
          if (!pick) {
            await say('Please contact us directly to change this booking.');
            return;
          }
          // Back to the booking question, keeping the same person or place.
          const answers = { ...lead.answers };
          delete answers[pick.key];
          const flowState = {
            ...(lead.flowState.resourceId !== undefined && {
              resourceId: lead.flowState.resourceId,
            }),
            reschedulingBookingId: booking.id,
          };
          const outcome = await converse(
            tx,
            number,
            { ...lead, status: 'in_conversation', answers, currentQuestionId: null, flowState },
            context,
            { kind: 'text', body: 'reschedule' },
          );
          newBooking = outcome.newBooking;
          return;
        }
        default:
          await deliver(tx, number, lead, [
            changeButtons(`Your booking: ${summary}. Need to change it?`),
          ]);
      }
    });
    if (newBooking?.status === 'confirmed') await scheduleReminders(newBooking.id);
    return found.lead.id;
  }

  async function processMessage(m: ParsedInbound) {
    const leadId = await processInbound(m);
    if (leadId && bus) {
      const lead = await db
        .select({ organizationId: schema.leads.organizationId })
        .from(schema.leads)
        .where(eq(schema.leads.id, leadId))
        .limit(1);
      if (lead[0]) {
        bus.publish(lead[0].organizationId, { type: 'message', leadId });
        bus.publish(lead[0].organizationId, { type: 'lead', leadId });
      }
    }
  }

  /** Returns the lead the message belonged to, if any. */
  async function processInbound(m: ParsedInbound): Promise<string | undefined> {
    const [number] = await db
      .select()
      .from(schema.whatsappNumbers)
      .where(
        and(
          eq(schema.whatsappNumbers.phoneNumberId, m.phoneNumberId),
          eq(schema.whatsappNumbers.status, 'active'),
        ),
      )
      .limit(1);
    if (!number) {
      logger.warn({ phoneNumberId: m.phoneNumberId }, 'webhook for an unknown WhatsApp number');
      return undefined;
    }

    // A redelivered webhook hits the unique index and is dropped here.
    const [stored] = await db
      .insert(schema.messages)
      .values({
        organizationId: number.organizationId,
        whatsappNumberId: number.id,
        waMessageId: m.waMessageId,
        phone: m.from,
        direction: 'in',
        type: m.type,
        body: m.message,
      })
      .onConflictDoNothing({ target: schema.messages.waMessageId })
      .returning({ id: schema.messages.id });
    if (!stored) return undefined;

    const found = await findOpenLead(number, m.from);
    if (!found) return handleAftercare(number, m, stored.id);

    await db
      .update(schema.messages)
      .set({ leadId: found.id })
      .where(eq(schema.messages.id, stored.id));
    await db
      .update(schema.leads)
      .set({ lastInboundAt: new Date() })
      .where(eq(schema.leads.id, found.id));

    let newBooking: { id: string; status: string } | undefined;
    await db.transaction(async (tx) => {
      // One message at a time per lead, across API instances.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${found.id}, 0))`);
      const [lead] = await tx.select().from(schema.leads).where(eq(schema.leads.id, found.id));
      if (!lead || !OPEN_STATUSES.includes(lead.status as (typeof OPEN_STATUSES)[number])) return;
      // A person has the chat: the message is stored for the inbox, the bot stays quiet.
      if (lead.botPaused || lead.status === 'needs_human') return;

      const context = await loadContext(tx, lead);
      newBooking = (await converse(tx, number, lead, context, m.message)).newBooking;
    });
    if (newBooking?.status === 'confirmed') await scheduleReminders(newBooking.id);
    return found.id;
  }

  /** The lead, its number and a lock on it, for staff actions. Throws if it is not theirs. */
  async function withLead<T>(
    organizationId: string,
    leadId: string,
    run: (tx: Tx, lead: LeadRow, number: NumberRow) => Promise<T>,
  ): Promise<T> {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${leadId}, 0))`);
      const [row] = await tx
        .select({ lead: schema.leads, number: schema.whatsappNumbers })
        .from(schema.leads)
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
        .innerJoin(
          schema.whatsappNumbers,
          eq(schema.whatsappNumbers.id, schema.campaigns.whatsappNumberId),
        )
        .where(and(eq(schema.leads.id, leadId), eq(schema.leads.organizationId, organizationId)));
      if (!row) throw new LeadError('not_found', 'lead not found');
      return run(tx, row.lead, row.number);
    });
    bus?.publish(organizationId, { type: 'lead', leadId });
    bus?.publish(organizationId, { type: 'message', leadId });
    return result;
  }

  return {
    /** A person answers in the chat. The bot steps aside until the chat is handed back. */
    staffReply(input: { organizationId: string; leadId: string; userId: string; text: string }) {
      return withLead(input.organizationId, input.leadId, async (tx, lead, number) => {
        if (!windowOpen(lead)) {
          throw new LeadError(
            'window_closed',
            'It has been over 24 hours since they wrote, so WhatsApp only allows a template message.',
          );
        }
        await deliver(tx, number, lead, [{ kind: 'text', body: input.text }], {
          sentByUserId: input.userId,
        });
        if (lead.status === 'new' || lead.status === 'in_conversation') {
          await tx
            .update(schema.leads)
            .set({ status: 'needs_human', botPaused: true })
            .where(eq(schema.leads.id, lead.id));
        }
      });
    },

    /** The bot takes the chat back and carries on with the next unanswered question. */
    handBack(input: { organizationId: string; leadId: string }) {
      return withLead(input.organizationId, input.leadId, async (tx, lead, number) => {
        if (lead.status !== 'needs_human') {
          throw new LeadError('bad_state', 'This chat is not waiting for a person.');
        }
        if (!windowOpen(lead)) {
          throw new LeadError(
            'window_closed',
            'It has been over 24 hours since they wrote, so the bot cannot message them yet.',
          );
        }
        const context = await loadContext(tx, lead);
        const { newBooking } = await converse(
          tx,
          number,
          { ...lead, status: 'in_conversation', botPaused: false, currentQuestionId: null },
          context,
          { kind: 'text', body: 'continue' },
        );
        return newBooking;
      }).then(async (newBooking) => {
        if (newBooking?.status === 'confirmed') await scheduleReminders(newBooking.id);
      });
    },

    /** The person has dealt with it; nothing more for the bot to do. */
    closeLead(input: { organizationId: string; leadId: string }) {
      return withLead(input.organizationId, input.leadId, async (tx, lead) => {
        if (lead.status === 'completed' || lead.status === 'dropped') {
          throw new LeadError('bad_state', 'This lead is already closed.');
        }
        await tx
          .update(schema.leads)
          .set({ status: 'completed', botPaused: false, currentQuestionId: null })
          .where(eq(schema.leads.id, lead.id));
        await tx
          .insert(schema.leadEvents)
          .values({ leadId: lead.id, campaignId: lead.campaignId, type: 'completed' });
      });
    },

    /** Handles everything in a webhook payload; one bad message doesn't stop the rest. */
    async handleWebhook(parsed: ParsedWebhook) {
      for (const status of parsed.statuses) {
        await db
          .update(schema.messages)
          .set({ deliveryStatus: status.status })
          .where(eq(schema.messages.waMessageId, status.waMessageId))
          .catch((err) => logger.error({ err }, 'failed to record delivery status'));
      }
      for (const message of parsed.messages) {
        try {
          await processMessage(message);
        } catch (err) {
          logger.error(
            { err, waMessageId: message.waMessageId },
            'failed to process inbound message',
          );
        }
      }
    },

    /**
     * Tells the customer a booking was confirmed, declined or cancelled, in the chat they
     * booked from. Returns false when there was nothing to send it through.
     */
    async notifyBooking(
      bookingId: string,
      status: Extract<BookingStatus, 'confirmed' | 'rejected' | 'cancelled'>,
    ) {
      const [row] = await db
        .select({
          booking: schema.bookings,
          lead: schema.leads,
          config: schema.campaignVersions.config,
          businessName: schema.organization.name,
          timeZone: schema.businessSettings.timezone,
          number: schema.whatsappNumbers,
          resourceName: schema.resources.name,
          eventName: schema.events.name,
        })
        .from(schema.bookings)
        .innerJoin(schema.leads, eq(schema.leads.id, schema.bookings.leadId))
        .innerJoin(
          schema.campaignVersions,
          eq(schema.campaignVersions.id, schema.leads.campaignVersionId),
        )
        .innerJoin(schema.organization, eq(schema.organization.id, schema.bookings.organizationId))
        .innerJoin(
          schema.businessSettings,
          eq(schema.businessSettings.organizationId, schema.bookings.organizationId),
        )
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
        .innerJoin(
          schema.whatsappNumbers,
          eq(schema.whatsappNumbers.id, schema.campaigns.whatsappNumberId),
        )
        .leftJoin(schema.resources, eq(schema.resources.id, schema.bookings.resourceId))
        .leftJoin(schema.events, eq(schema.events.id, schema.bookings.eventId))
        .where(eq(schema.bookings.id, bookingId));
      if (!row) return false;
      if (status === 'confirmed') await scheduleReminders(bookingId);
      // Free-form messages are only allowed shortly after the customer last wrote.
      if (!windowOpen(row.lead)) return false;

      const text = {
        confirmed: row.config.settings.confirmation,
        rejected:
          "Sorry {{name}}, {{business}} couldn't confirm your booking for {{booking.date}} at {{booking.time}}. Reply here if you'd like to pick another time.",
        cancelled:
          'Your booking at {{business}} for {{booking.date}} at {{booking.time}} has been cancelled.',
      }[status];
      const body = renderPlaceholders(text, {
        name: row.lead.name,
        business: row.businessName,
        answers: displayAnswers(row.config.questions, row.lead.answers),
        booking: {
          date: formatDay(row.booking.startsAt, row.timeZone),
          time: formatTime(row.booking.startsAt, row.timeZone),
          resource: row.resourceName ?? row.eventName ?? '',
        },
      });
      await deliver(db, row.number, row.lead, [{ kind: 'text', body }]);
      bus?.publish(row.booking.organizationId, { type: 'message', leadId: row.lead.id });
      return true;
    },

    /**
     * Sends the template that opens the chat after a form submission. In test mode that is
     * Meta's pre-approved hello_world; otherwise the campaign's own template.
     */
    async sendOpeningTemplate(leadId: string) {
      const [row] = await db
        .select({
          lead: schema.leads,
          config: schema.campaignVersions.config,
          businessName: schema.organization.name,
          number: schema.whatsappNumbers,
        })
        .from(schema.leads)
        .innerJoin(
          schema.campaignVersions,
          eq(schema.campaignVersions.id, schema.leads.campaignVersionId),
        )
        .innerJoin(schema.organization, eq(schema.organization.id, schema.leads.organizationId))
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
        .innerJoin(
          schema.whatsappNumbers,
          eq(schema.whatsappNumbers.id, schema.campaigns.whatsappNumberId),
        )
        .where(eq(schema.leads.id, leadId));
      if (!row) {
        logger.warn({ leadId }, 'no WhatsApp number to send the opening template from');
        return;
      }
      const { lead, config } = row;
      const configured = config.settings.openingTemplate;
      const ctx = {
        name: lead.name,
        business: row.businessName,
        answers: displayAnswers(config.questions, lead.answers),
      };
      const message: SendableMessage =
        templateMode === 'test'
          ? { kind: 'template', ...TEST_TEMPLATE }
          : {
              kind: 'template',
              name: configured.name,
              language: configured.language,
              params: configured.params.map((p) => renderPlaceholders(p, ctx)),
            };
      await deliver(db, row.number, lead, [message]);
    },
  };
}

export type ConversationService = ReturnType<typeof createConversationService>;
