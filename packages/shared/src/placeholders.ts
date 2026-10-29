import type { Answers, Question } from './campaign/questions.js';
import { optionsOf } from './campaign/questions.js';

const PLACEHOLDER = /\{\{\s*([a-z0-9_.]+)\s*\}\}/gi;

export const BOOKING_PLACEHOLDERS = ['booking.date', 'booking.time', 'booking.resource'] as const;
export const SIMPLE_PLACEHOLDERS = ['name', 'business'] as const;

export interface PlaceholderContext {
  name?: string;
  business?: string;
  /** Display-ready answers by question key (see `displayAnswers`). */
  answers?: Record<string, string>;
  booking?: { date?: string; time?: string; resource?: string };
}

/** Every `{{token}}` in a text, trimmed and lowercased, in order of appearance. */
export function extractPlaceholders(text: string): string[] {
  return Array.from(text.matchAll(PLACEHOLDER), (match) => (match[1] ?? '').toLowerCase());
}

/** Whether a placeholder token is one the platform knows, given the campaign's answer keys. */
export function isKnownPlaceholder(token: string, answerKeys: ReadonlySet<string>): boolean {
  if ((SIMPLE_PLACEHOLDERS as readonly string[]).includes(token)) return true;
  if ((BOOKING_PLACEHOLDERS as readonly string[]).includes(token)) return true;
  return token.startsWith('answers.') && answerKeys.has(token.slice('answers.'.length));
}

function resolve(token: string, ctx: PlaceholderContext): string | undefined {
  if (token === 'name') return ctx.name;
  if (token === 'business') return ctx.business;
  if (token.startsWith('answers.')) return ctx.answers?.[token.slice('answers.'.length)];
  if (token.startsWith('booking.')) {
    const field = token.slice('booking.'.length) as keyof NonNullable<
      PlaceholderContext['booking']
    >;
    return ctx.booking?.[field];
  }
  return undefined;
}

/** Fills placeholders; anything unknown or not yet answered renders as an empty string. */
export function renderPlaceholders(text: string, ctx: PlaceholderContext): string {
  return text.replace(
    PLACEHOLDER,
    (_match, token: string) => resolve(token.toLowerCase(), ctx) ?? '',
  );
}

function displayValue(question: Question | undefined, value: Answers[string]): string {
  const labelOf = (id: string) =>
    optionsOf(question ?? { type: 'short_text' }).find((o) => o.id === id)?.label ?? id;
  if (Array.isArray(value)) return value.map(labelOf).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return question?.type === 'single_choice' || question?.type === 'yes_no' ? labelOf(value) : value;
}

/** Turns stored answers (option ids, booleans, lists) into the text people should see. */
export function displayAnswers(
  questions: readonly Question[],
  answers: Answers,
): Record<string, string> {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [key, displayValue(byKey.get(key), value)]),
  );
}
