import { extractPlaceholders, isKnownPlaceholder, BOOKING_PLACEHOLDERS } from '../placeholders.js';
import { WHATSAPP_LIMITS } from '../whatsapp/limits.js';
import { campaignConfigSchema, type CampaignConfig } from './config.js';
import {
  BOOKING_TYPES,
  CHANNEL_SUPPORT,
  CHOICE_TYPES,
  RESERVED_KEYS,
  optionsOf,
  resolveWhatsAppRender,
  type Question,
} from './questions.js';

export interface ValidationIssue {
  /** `error` blocks publishing; `warning` is shown but allowed. */
  severity: 'error' | 'warning';
  /** Dotted location, e.g. `questions.2.options`. */
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; config: CampaignConfig; issues: ValidationIssue[] }
  | { valid: false; issues: ValidationIssue[] };

function checkQuestion(q: Question, index: number, issues: ValidationIssue[]) {
  const at = `questions.${index}`;
  const error = (field: string, message: string) =>
    issues.push({ severity: 'error', path: `${at}.${field}`, message });

  if (!CHANNEL_SUPPORT[q.type].includes(q.channel)) {
    error(
      'channel',
      BOOKING_TYPES.includes(q.type)
        ? `${q.type} is only available in WhatsApp for now`
        : `${q.type} can't be asked in ${q.channel === 'whatsapp' ? 'WhatsApp' : 'the form'}`,
    );
  }

  const options = optionsOf(q);
  if (CHOICE_TYPES.includes(q.type)) {
    if (options.length < 2) error('options', 'Add at least two choices');
    const ids = new Set<string>();
    for (const option of options) {
      if (ids.has(option.id)) error('options', `Choice id "${option.id}" is used twice`);
      ids.add(option.id);
    }
  } else if (q.options?.length) {
    error('options', `${q.type} questions don't take choices`);
  }

  if (q.channel !== 'whatsapp') return;

  const render = resolveWhatsAppRender(q);
  if (render.mode === 'invalid') {
    // The channel error above already explains unsupported types.
    if (CHANNEL_SUPPORT[q.type].includes('whatsapp')) error('options', render.reason);
    return;
  }
  if (render.mode === 'text') return;

  if (q.prompt.length > WHATSAPP_LIMITS.interactiveBodyMaxLength) {
    error(
      'prompt',
      `Keep it under ${WHATSAPP_LIMITS.interactiveBodyMaxLength} characters in WhatsApp`,
    );
  }
  const titleMax =
    render.mode === 'buttons'
      ? WHATSAPP_LIMITS.replyButtons.titleMaxLength
      : WHATSAPP_LIMITS.list.rowTitleMaxLength;
  for (const option of q.type === 'single_choice' ? options : []) {
    if (option.label.length > titleMax) {
      error(
        'options',
        `"${option.label}" is over ${titleMax} characters, the limit for WhatsApp ${render.mode === 'buttons' ? 'buttons' : 'list rows'}`,
      );
    }
    if (
      render.mode === 'list' &&
      (option.description?.length ?? 0) > WHATSAPP_LIMITS.list.rowDescriptionMaxLength
    ) {
      error(
        'options',
        `The description of "${option.label}" is over ${WHATSAPP_LIMITS.list.rowDescriptionMaxLength} characters`,
      );
    }
  }
}

function checkPlaceholders(
  text: string,
  path: string,
  keys: ReadonlySet<string>,
  goal: string,
  issues: ValidationIssue[],
) {
  for (const token of extractPlaceholders(text)) {
    if (!isKnownPlaceholder(token, keys)) {
      issues.push({ severity: 'error', path, message: `{{${token}}} isn't a known placeholder` });
    } else if (goal !== 'booking' && (BOOKING_PLACEHOLDERS as readonly string[]).includes(token)) {
      issues.push({
        severity: 'error',
        path,
        message: `{{${token}}} only works in booking campaigns`,
      });
    }
  }
}

/** Structure plus the rules that depend on several questions or on the settings. */
function checkCampaign(config: CampaignConfig, issues: ValidationIssue[]) {
  const { questions, settings } = config;
  const error = (path: string, message: string) =>
    issues.push({ severity: 'error', path, message });

  const ids = new Set<string>();
  const keys = new Set<string>();
  questions.forEach((q, i) => {
    if (ids.has(q.id)) error(`questions.${i}.id`, `Question id "${q.id}" is used twice`);
    ids.add(q.id);
    if ((RESERVED_KEYS as readonly string[]).includes(q.key)) {
      error(`questions.${i}.key`, `"${q.key}" is collected on every form already`);
    } else if (keys.has(q.key)) {
      error(`questions.${i}.key`, `Answer key "${q.key}" is used twice`);
    }
    keys.add(q.key);
    checkQuestion(q, i, issues);
  });

  const bookingGoal = settings.goal === 'booking';
  const indexOf = (type: Question['type']) => questions.findIndex((q) => q.type === type);
  const count = (type: Question['type']) => questions.filter((q) => q.type === type).length;

  for (const type of BOOKING_TYPES) {
    if (count(type) > 1) error('questions', `Use ${type} at most once`);
  }
  if (!bookingGoal) {
    questions.forEach((q, i) => {
      if (BOOKING_TYPES.includes(q.type)) {
        error(`questions.${i}.type`, `${q.type} needs the booking goal`);
      }
    });
  } else {
    if (count('pick_slot') + count('pick_event') !== 1) {
      error('questions', 'A booking campaign needs exactly one of pick_slot or pick_event');
    }
    if (count('pick_slot') === 1) {
      const needsPicker = settings.resourceSelection === 'customer_picks';
      const resourceAt = indexOf('pick_resource');
      if (needsPicker && (resourceAt === -1 || resourceAt > indexOf('pick_slot'))) {
        error('questions', 'Ask pick_resource before pick_slot, or switch to auto-assign');
      }
      if (!needsPicker && resourceAt !== -1) {
        error('questions', 'pick_resource is not used when resources are auto-assigned');
      }
    }
    if (count('pick_event') === 1 && count('pick_resource') > 0) {
      error('questions', 'Events are booked without choosing a resource');
    }
    if (settings.countPartySize && count('party_size') === 0) {
      error('settings.countPartySize', 'Add a party_size question to count it against capacity');
    }
  }

  if (settings.reminderOffsets.length !== new Set(settings.reminderOffsets).size) {
    error('settings.reminderOffsets', 'Each reminder time can only appear once');
  }

  for (const [path, ref] of [
    ['settings.openingTemplate', settings.openingTemplate],
    ['settings.reminderTemplate', settings.reminderTemplate],
  ] as const) {
    ref?.params.forEach((param, i) =>
      checkPlaceholders(param, `${path}.params.${i}`, keys, settings.goal, issues),
    );
  }
  questions.forEach((q, i) =>
    checkPlaceholders(q.prompt, `questions.${i}.prompt`, keys, settings.goal, issues),
  );
  checkPlaceholders(settings.confirmation, 'settings.confirmation', keys, settings.goal, issues);
  checkPlaceholders(settings.handoff.ack, 'settings.handoff.ack', keys, settings.goal, issues);

  if (bookingGoal && settings.reminderOffsets.length > 0 && !settings.reminderTemplate) {
    issues.push({
      severity: 'warning',
      path: 'settings.reminderTemplate',
      message:
        'Reminders usually go out after the 24-hour chat window has closed, so they need an approved template',
    });
  }
}

/**
 * Parses and checks a campaign config. Shared by the builder (live feedback) and the API
 * (the publish gate). `valid` is false when any `error` issue exists.
 */
export function validateCampaign(input: unknown): ValidationResult {
  const parsed = campaignConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        severity: 'error' as const,
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const issues: ValidationIssue[] = [];
  checkCampaign(parsed.data, issues);
  if (issues.some((i) => i.severity === 'error')) return { valid: false, issues };
  return { valid: true, config: parsed.data, issues };
}
