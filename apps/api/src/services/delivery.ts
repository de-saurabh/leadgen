import type { AppDb } from '../auth/auth.js';
import * as schema from '../db/schema/index.js';
import type { GraphClient, SendableMessage } from '../whatsapp/graph.js';
import type { SecretBox } from './crypto.js';

export type NumberRow = typeof schema.whatsappNumbers.$inferSelect;
type LeadRow = typeof schema.leads.$inferSelect;

/** Customers can be sent free-form messages for this long after they last wrote. */
export const FREE_FORM_WINDOW_MS = 24 * 3_600_000;

export function windowOpen(lead: Pick<LeadRow, 'lastInboundAt'>, now: Date = new Date()): boolean {
  return !!lead.lastInboundAt && now.getTime() - lead.lastInboundAt.getTime() < FREE_FORM_WINDOW_MS;
}

/**
 * Sends to a customer and records each message that went out. `exec` is the transaction
 * when there is one, so a conversation step never needs a second pool connection.
 */
export function createDelivery({ box, graph }: { box: SecretBox; graph: GraphClient }) {
  return async function deliver(
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
  };
}

export type Deliver = ReturnType<typeof createDelivery>;
