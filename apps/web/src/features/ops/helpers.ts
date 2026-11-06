import type { LeadStatus } from './api';

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  in_conversation: 'Chatting',
  completed: 'Done',
  needs_human: 'Needs a person',
  dropped: 'Went quiet',
};

/** The text of one chat message as a person would read it. */
export function describeMessage(type: string, body: Record<string, unknown>): string {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  switch (type) {
    case 'text':
      return text(body.body);
    case 'buttons':
    case 'list': {
      const options = Array.isArray(body.options)
        ? (body.options as Array<{ title?: string }>)
        : [];
      const titles = options.map((o) => o.title).filter(Boolean);
      return `${text(body.body)}${titles.length ? `\n[${titles.join(' | ')}]` : ''}`;
    }
    case 'template':
      return `Template message (${text(body.name)})`;
    case 'reply':
      return text(body.title) || text(body.id);
    case 'interactive':
      return text(body.title) || text(body.id);
    default:
      return `[${type} message]`;
  }
}

/** Whether staff can still send free-form messages (WhatsApp's 24 hour window). */
export function windowIsOpen(lastInboundAt: string | null, now: number = Date.now()): boolean {
  return !!lastInboundAt && now - new Date(lastInboundAt).getTime() < 24 * 3_600_000;
}

/** "5 min ago", "3 h ago", "2 d ago" */
export function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never';
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** Answers as readable text: option ids, booleans and lists. */
export function answerText(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value ?? '');
}
