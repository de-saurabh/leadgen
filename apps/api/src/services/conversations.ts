import { renderPlaceholders, displayAnswers } from '@leadgen/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';
import { advance } from '../engine/engine.js';
import { createBookingPort } from './booking.js';
import type { Logger } from '../logger.js';
import type { GraphClient, SendableMessage } from '../whatsapp/graph.js';
import type { ParsedInbound, ParsedWebhook } from '../whatsapp/webhook.js';
import type { SecretBox } from './crypto.js';

type NumberRow = typeof schema.whatsappNumbers.$inferSelect;
type LeadRow = typeof schema.leads.$inferSelect;

export interface ConversationDeps {
  db: AppDb;
  box: SecretBox;
  graph: GraphClient;
  logger: Logger;
  templateMode: 'test' | 'live';
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
}: ConversationDeps) {
  /**
   * Sends to a customer and records each message that went out. `exec` is the transaction
   * when there is one, so a conversation step never needs a second pool connection.
   */
  async function deliver(
    exec: Pick<AppDb, 'insert'>,
    number: NumberRow,
    lead: Pick<LeadRow, 'id' | 'organizationId' | 'phone'>,
    messages: SendableMessage[],
  ) {
    const target = {
      phoneNumberId: number.phoneNumberId,
      accessToken: box.decrypt(number.accessTokenEnc),
    };
    for (const message of messages) {
      const { waMessageId } = await graph.send(target, lead.phone, message);
      await exec.insert(schema.messages).values({
        organizationId: lead.organizationId,
        leadId: lead.id,
        whatsappNumberId: number.id,
        waMessageId,
        phone: lead.phone,
        direction: 'out',
        type: message.kind,
        body: { ...message },
        deliveryStatus: 'sent',
      });
    }
  }

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

  async function processMessage(m: ParsedInbound) {
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
      return;
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
    if (!stored) return;

    const found = await findOpenLead(number, m.from);
    if (!found) return;

    await db
      .update(schema.messages)
      .set({ leadId: found.id })
      .where(eq(schema.messages.id, stored.id));
    await db
      .update(schema.leads)
      .set({ lastInboundAt: new Date() })
      .where(eq(schema.leads.id, found.id));

    await db.transaction(async (tx) => {
      // One message at a time per lead, across API instances.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${found.id}, 0))`);
      const [lead] = await tx.select().from(schema.leads).where(eq(schema.leads.id, found.id));
      if (!lead || !OPEN_STATUSES.includes(lead.status as (typeof OPEN_STATUSES)[number])) return;
      // A person has the chat: the message is stored for the inbox, the bot stays quiet.
      if (lead.botPaused || lead.status === 'needs_human') return;

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

      const result = await advance({
        lead: {
          name: lead.name,
          status: lead.status,
          answers: lead.answers,
          currentQuestionId: lead.currentQuestionId,
          flowState: lead.flowState,
        },
        config: row.config,
        businessName: row.businessName,
        message: m.message,
        booking: createBookingPort(tx, {
          organizationId: lead.organizationId,
          campaignId: lead.campaignId,
          leadId: lead.id,
          timeZone: row.timeZone,
          countPartySize: row.config.settings.countPartySize,
          requiresApproval: row.config.settings.requiresApproval,
        }),
      });

      // Sent before committing: if WhatsApp refuses, the state change rolls back and the
      // customer's next message is handled from where they were.
      await deliver(tx, number, lead, result.outbound);

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
    });
  }

  return {
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
