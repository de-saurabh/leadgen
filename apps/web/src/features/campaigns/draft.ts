import {
  CHANNEL_SUPPORT,
  type CampaignConfigInput,
  type Channel,
  type Question,
  type QuestionType,
  type ValidationIssue,
} from '@leadgen/shared';

export type DraftQuestion = CampaignConfigInput['questions'][number];

export const TYPE_LABELS: Record<QuestionType, string> = {
  short_text: 'Short answer',
  long_text: 'Long answer',
  email: 'Email',
  number: 'Number',
  date: 'Date',
  single_choice: 'Pick one',
  yes_no: 'Yes / No',
  multi_choice: 'Pick several',
  party_size: 'Number of people',
  pick_resource: 'Choose who or what',
  pick_slot: 'Choose a time',
  pick_event: 'Choose an event',
};

export const BOOKING_QUESTION_TYPES: readonly QuestionType[] = [
  'pick_resource',
  'pick_slot',
  'pick_event',
];

export const CHOICE_QUESTION_TYPES: readonly QuestionType[] = ['single_choice', 'multi_choice'];

/** `What's your budget?` becomes `whats_your_budget`; empty text gives an empty key. */
export function slugKey(text: string): string {
  const key = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
    .replace(/_+$/, '');
  return /^[a-z]/.test(key) ? key : key ? `q_${key}`.slice(0, 40) : '';
}

/** Makes `base` unique among `taken` by adding `_2`, `_3`, and so on. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 36)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export const DEFAULT_CONFIRMATION = {
  lead: 'Thanks {{name}}! {{business}} will be in touch shortly.',
  booking:
    'Booked, {{name}}! {{booking.date}} at {{booking.time}} with {{booking.resource}}. See you at {{business}}.',
} as const;

/**
 * The confirmation to use after the goal changes: an untouched default follows the goal,
 * while text the owner wrote is left alone.
 */
export function confirmationForGoal(
  current: string | undefined,
  goal: 'lead' | 'booking',
): string | undefined {
  const untouched =
    current === undefined ||
    current === DEFAULT_CONFIRMATION.lead ||
    current === DEFAULT_CONFIRMATION.booking;
  return untouched ? DEFAULT_CONFIRMATION[goal] : current;
}

export function emptyDraft(): CampaignConfigInput {
  return {
    questions: [],
    settings: {
      goal: 'lead',
      confirmation: DEFAULT_CONFIRMATION.lead,
    },
  };
}

/** The channel a new question of this type starts on: the only one it allows, else WhatsApp. */
export function defaultChannel(type: QuestionType): Channel {
  const allowed = CHANNEL_SUPPORT[type];
  return allowed.includes('whatsapp') ? 'whatsapp' : (allowed[0] ?? 'form');
}

export function newQuestion(
  type: QuestionType,
  existing: readonly Pick<Question, 'id' | 'key'>[],
): DraftQuestion {
  const ids = new Set(existing.map((q) => q.id));
  const keys = new Set(existing.map((q) => q.key));
  const base = type.startsWith('pick_') ? type : slugKey(TYPE_LABELS[type]) || 'question';
  const id = uniqueId(base, ids);
  const question: DraftQuestion = {
    id,
    key: uniqueId(base, keys),
    type,
    channel: defaultChannel(type),
    prompt: '',
    required: true,
  };
  if (type === 'single_choice' || type === 'multi_choice') {
    question.options = [
      { id: 'option_1', label: 'Option 1' },
      { id: 'option_2', label: 'Option 2' },
    ];
  }
  return question;
}

/** Changes a question's type, keeping the channel valid and dropping options that no longer apply. */
export function changeType(question: DraftQuestion, type: QuestionType): DraftQuestion {
  const next: DraftQuestion = { ...question, type };
  if (!CHANNEL_SUPPORT[type].includes(next.channel)) next.channel = defaultChannel(type);
  if (type === 'single_choice' || type === 'multi_choice') {
    next.options = question.options?.length
      ? question.options
      : [
          { id: 'option_1', label: 'Option 1' },
          { id: 'option_2', label: 'Option 2' },
        ];
  } else {
    delete next.options;
  }
  return next;
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return [...items];
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved as T);
  return copy;
}

/** A choice id derived from its label, unique among the question's other choices. */
export function optionIdFor(label: string, taken: ReadonlySet<string>): string {
  return uniqueId(slugKey(label) || 'option', taken);
}

/** Issues whose path points at `questions.<index>` (or below it). */
export function issuesForQuestion(issues: readonly ValidationIssue[], index: number) {
  const prefix = `questions.${index}`;
  return issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));
}

/** Issues not tied to one question: settings, or the question list as a whole. */
export function issuesForCampaign(issues: readonly ValidationIssue[]) {
  return issues.filter((i) => !/^questions\.\d+/.test(i.path));
}
