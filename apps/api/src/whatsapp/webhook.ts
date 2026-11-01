import { createHmac, timingSafeEqual } from 'node:crypto';
import type { InboundMessage } from '@leadgen/shared';

export interface ParsedInbound {
  phoneNumberId: string;
  waMessageId: string;
  /** The customer's number, digits only. */
  from: string;
  type: string;
  message: InboundMessage;
}

export interface ParsedStatus {
  waMessageId: string;
  status: string;
}

export interface ParsedWebhook {
  messages: ParsedInbound[];
  statuses: ParsedStatus[];
}

/** Checks Meta's `X-Hub-Signature-256` header against the raw request body. */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice('sha256='.length), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function toInbound(raw: Json): { type: string; message: InboundMessage } {
  const type = str(raw.type) ?? 'unknown';
  if (type === 'text') {
    return { type, message: { kind: 'text', body: str(obj(raw.text).body) ?? '' } };
  }
  if (type === 'interactive') {
    const interactive = obj(raw.interactive);
    const picked = obj(interactive.button_reply ?? interactive.list_reply);
    const id = str(picked.id);
    if (id) return { type, message: { kind: 'reply', id, title: str(picked.title) ?? '' } };
  }
  if (type === 'button') {
    // A tap on a template's quick-reply button.
    const button = obj(raw.button);
    const id = str(button.payload);
    if (id) return { type, message: { kind: 'reply', id, title: str(button.text) ?? '' } };
  }
  return { type, message: { kind: 'other', type } };
}

/** Pulls customer messages and delivery statuses out of a Cloud API webhook payload. */
export function parseWebhook(payload: unknown): ParsedWebhook {
  const result: ParsedWebhook = { messages: [], statuses: [] };
  const entries = obj(payload).entry;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const changes = obj(entry).changes;
    for (const change of Array.isArray(changes) ? changes : []) {
      if (obj(change).field !== 'messages') continue;
      const value = obj(obj(change).value);
      const phoneNumberId = str(obj(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;

      for (const raw of Array.isArray(value.messages) ? value.messages : []) {
        const m = obj(raw);
        const waMessageId = str(m.id);
        const from = str(m.from)?.replace(/\D/g, '');
        if (!waMessageId || !from) continue;
        result.messages.push({ phoneNumberId, waMessageId, from, ...toInbound(m) });
      }
      for (const raw of Array.isArray(value.statuses) ? value.statuses : []) {
        const s = obj(raw);
        const waMessageId = str(s.id);
        const status = str(s.status);
        if (waMessageId && status) result.statuses.push({ waMessageId, status });
      }
    }
  }
  return result;
}
