import { z } from 'zod';
import { interactiveKindFor, WHATSAPP_LIMITS, type InteractiveKind } from '../whatsapp/limits.js';

export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'email',
  'number',
  'date',
  'single_choice',
  'yes_no',
  'multi_choice',
  'party_size',
  'pick_resource',
  'pick_slot',
  'pick_event',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CHANNELS = ['form', 'whatsapp'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Answers the platform collects itself on every form; campaigns can't redefine them. */
export const RESERVED_KEYS = ['name', 'phone', 'consent'] as const;

/** Types whose options the owner writes by hand. */
export const CHOICE_TYPES: readonly QuestionType[] = ['single_choice', 'multi_choice'];

/** Types the bot fills from live availability; they exist only in WhatsApp. */
export const BOOKING_TYPES: readonly QuestionType[] = ['pick_resource', 'pick_slot', 'pick_event'];

/** Which channels can show each question type. */
export const CHANNEL_SUPPORT: Record<QuestionType, readonly Channel[]> = {
  short_text: ['form', 'whatsapp'],
  long_text: ['form', 'whatsapp'],
  email: ['form', 'whatsapp'],
  number: ['form', 'whatsapp'],
  date: ['form', 'whatsapp'],
  single_choice: ['form', 'whatsapp'],
  yes_no: ['form', 'whatsapp'],
  multi_choice: ['form'],
  party_size: ['form', 'whatsapp'],
  pick_resource: ['whatsapp'],
  pick_slot: ['whatsapp'],
  pick_event: ['whatsapp'],
};

export const PARTY_SIZE_MAX_ON_WHATSAPP = WHATSAPP_LIMITS.list.maxRows;

/** Ids end up inside WhatsApp reply ids as `<questionId>:<optionId>`, so ':' is off limits. */
const idSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits and underscores');

const keySchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z][a-z0-9_]*$/, 'Start with a letter; use lowercase letters, digits and underscores');

export const optionSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(200).optional(),
});
export type QuestionOption = z.infer<typeof optionSchema>;

export const questionSchema = z.object({
  id: idSchema,
  key: keySchema,
  type: z.enum(QUESTION_TYPES),
  channel: z.enum(CHANNELS),
  prompt: z.string().trim().min(1).max(WHATSAPP_LIMITS.textBodyMaxLength),
  required: z.boolean().default(true),
  options: z.array(optionSchema).max(50).optional(),
});
export type Question = z.infer<typeof questionSchema>;

export type AnswerValue = string | number | boolean | string[];
export type Answers = Record<string, AnswerValue>;

export const YES_OPTIONS = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
] as const satisfies readonly QuestionOption[];

/** The options a question offers: the owner's own, the fixed Yes/No pair, or none. */
export function optionsOf(question: Pick<Question, 'type' | 'options'>): readonly QuestionOption[] {
  if (question.type === 'yes_no') return YES_OPTIONS;
  return question.options ?? [];
}

export type WhatsAppRender =
  | { mode: 'text' }
  | { mode: 'buttons' | 'list'; optionCount: number }
  /** The question can't be asked in WhatsApp as configured. */
  | { mode: 'invalid'; reason: string };

/**
 * How the bot asks a question. The "talk to a human" choice is not counted here: the
 * engine adds it only where it still fits (see `handoffFits`), so it never makes a
 * question invalid, it just drops out.
 */
export function resolveWhatsAppRender(question: Question): WhatsAppRender {
  if (!CHANNEL_SUPPORT[question.type].includes('whatsapp')) {
    return { mode: 'invalid', reason: `${question.type} questions can't be asked in WhatsApp` };
  }
  switch (question.type) {
    case 'single_choice':
    case 'yes_no': {
      const count = optionsOf(question).length;
      const kind: InteractiveKind | null = interactiveKindFor(count);
      return kind
        ? { mode: kind, optionCount: count }
        : {
            mode: 'invalid',
            reason: `WhatsApp can show at most ${WHATSAPP_LIMITS.list.maxRows} choices; this has ${count}`,
          };
    }
    case 'party_size':
      return { mode: 'list', optionCount: PARTY_SIZE_MAX_ON_WHATSAPP };
    case 'pick_resource':
    case 'pick_slot':
    case 'pick_event':
      // Built from live availability at send time, sized by the slot-picking rules.
      return { mode: 'list', optionCount: WHATSAPP_LIMITS.list.maxRows };
    default:
      return { mode: 'text' };
  }
}

/** Whether a "talk to a human" choice can be added next to the question's own options. */
export function handoffFits(optionCount: number): boolean {
  return interactiveKindFor(optionCount + 1) !== null;
}
