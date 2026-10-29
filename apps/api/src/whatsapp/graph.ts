import { randomUUID } from 'node:crypto';
import type { OutboundMessage } from '../engine/messages.js';

export interface TemplateMessage {
  kind: 'template';
  name: string;
  language: string;
  /** Values for the template's body variables, in order. */
  params?: string[] | undefined;
}

export type SendableMessage = OutboundMessage | TemplateMessage;

export interface SendTarget {
  phoneNumberId: string;
  accessToken: string;
}

export interface GraphClient {
  /** Sends one message and returns Meta's id for it. Throws `GraphError` on failure. */
  send(target: SendTarget, to: string, message: SendableMessage): Promise<{ waMessageId: string }>;
}

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: number,
  ) {
    super(message);
  }
}

/** The JSON body Meta expects for a message. Never includes credentials. */
export function toGraphPayload(to: string, message: SendableMessage): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  switch (message.kind) {
    case 'text':
      return { ...base, type: 'text', text: { body: message.body, preview_url: false } };
    case 'buttons':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: message.body },
          action: {
            buttons: message.options.map((o) => ({
              type: 'reply',
              reply: { id: o.id, title: o.title },
            })),
          },
        },
      };
    case 'list':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: message.body },
          action: {
            button: message.buttonText,
            sections: [
              {
                title: 'Options',
                rows: message.options.map((o) => ({
                  id: o.id,
                  title: o.title,
                  ...(o.description && { description: o.description }),
                })),
              },
            ],
          },
        },
      };
    case 'template':
      return {
        ...base,
        type: 'template',
        template: {
          name: message.name,
          language: { code: message.language },
          ...(message.params?.length && {
            components: [
              {
                type: 'body',
                parameters: message.params.map((text) => ({ type: 'text', text })),
              },
            ],
          }),
        },
      };
  }
}

export function createGraphClient(opts: { version: string; fetch?: typeof fetch }): GraphClient {
  const doFetch = opts.fetch ?? fetch;
  return {
    async send(target, to, message) {
      const res = await doFetch(
        `https://graph.facebook.com/${opts.version}/${target.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${target.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(toGraphPayload(to, message)),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id: string }>;
        error?: { message?: string; code?: number };
      };
      const id = json.messages?.[0]?.id;
      if (!res.ok || !id) {
        throw new GraphError(
          res.status,
          json.error?.message ?? `WhatsApp send failed with status ${res.status}`,
          json.error?.code,
        );
      }
      return { waMessageId: id };
    },
  };
}

/** Stands in for Meta in local development: nothing leaves the machine. */
export function createDryRunGraphClient(log: (line: string) => void): GraphClient {
  return {
    async send(_target, to, message) {
      log(`[dry-run] to ${to}: ${JSON.stringify(message)}`);
      return { waMessageId: `dry-run.${randomUUID()}` };
    },
  };
}
