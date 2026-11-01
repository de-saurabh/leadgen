/** What the bot says, independent of the channel that delivers it. */
export type OutboundMessage =
  | { kind: 'text'; body: string }
  | { kind: 'buttons'; body: string; options: ChoiceOption[] }
  | { kind: 'list'; body: string; buttonText: string; options: ChoiceOption[] };

export interface ChoiceOption {
  /** Round-trips through WhatsApp: `<questionId>:<optionId>`. */
  id: string;
  title: string;
  description?: string | undefined;
}

/** A customer's message, reduced to what the engine cares about. */
export type InboundMessage =
  | { kind: 'reply'; id: string; title: string }
  | { kind: 'text'; body: string }
  | { kind: 'other'; type: string };

/** Marks the "talk to a human" row inside `<questionId>:<marker>` reply ids. */
export const HANDOFF_MARKER = '__human';

export function replyId(questionId: string, optionId: string): string {
  return `${questionId}:${optionId}`;
}

export function parseReplyId(id: string): { questionId: string; optionId: string } | undefined {
  const at = id.indexOf(':');
  if (at <= 0) return undefined;
  return { questionId: id.slice(0, at), optionId: id.slice(at + 1) };
}
