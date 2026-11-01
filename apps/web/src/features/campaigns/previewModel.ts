import {
  BOOKING_TYPES,
  campaignConfigSchema,
  nextWhatsAppQuestion,
  optionsOf,
  parseReplyId,
  questionMessage,
  placeholderContext,
  renderPlaceholders,
  type Answers,
  type CampaignConfig,
  type CampaignConfigInput,
  type OutboundMessage,
  type Question,
  type RenderContext,
} from '@leadgen/shared';

export const SAMPLE_NAME = 'Alex';
const SAMPLE_BUSINESS = 'Your Business';
const SAMPLE_BOOKING = { date: 'Tue 12 Nov', time: '10:30', resource: 'Dr. Sample' };

export type PreviewStep =
  | { from: 'customer'; text: string }
  | { from: 'bot'; message: OutboundMessage }
  /** A live-availability question the bot builds from real slots, not shown in the preview. */
  | { from: 'note'; text: string };

/**
 * Parses a draft leniently for previewing: blank prompts and confirmation get placeholder
 * text so the preview works while the owner is still typing. Returns null if the draft is
 * structurally unusable.
 */
export function previewConfig(draft: CampaignConfigInput): CampaignConfig | null {
  const lenient: CampaignConfigInput = {
    questions: draft.questions.map((q) => ({
      ...q,
      prompt: q.prompt.trim() || '(question text)',
    })),
    settings: {
      ...draft.settings,
      confirmation: draft.settings.confirmation?.trim() || '(confirmation message)',
    },
  };
  const parsed = campaignConfigSchema.safeParse(lenient);
  return parsed.success ? parsed.data : null;
}

/** A believable answer to `q`, used to fill the preview. */
export function sampleAnswer(q: Question): Answers[string] {
  const first = optionsOf(q)[0]?.id;
  switch (q.type) {
    case 'single_choice':
    case 'yes_no':
      return first ?? '';
    case 'multi_choice':
      return first ? [first] : [];
    case 'party_size':
      return 2;
    case 'number':
      return 3;
    case 'date':
      return '2026-12-31';
    case 'email':
      return 'alex@example.com';
    case 'long_text':
      return 'Some more detail about this.';
    default:
      return 'Sample answer';
  }
}

/** What the customer would tap or type in reply to a message, for the preview. */
function replyTo(q: Question, message: OutboundMessage): string {
  if (message.kind === 'text') {
    return String(sampleAnswer(q)).replace(/^(\d{4})-(\d\d)-(\d\d)$/, '$3/$2/$1');
  }
  const picked =
    q.type === 'party_size'
      ? message.options.find((o) => parseReplyId(o.id)?.optionId === '2')
      : message.options[0];
  return picked?.title ?? '';
}

/**
 * The WhatsApp side of a campaign as a conversation: what the customer would see if they
 * filled the form with sample answers and tapped through. Questions the form already
 * answered are skipped, exactly as in the live bot.
 */
export function buildWhatsAppPreview(config: CampaignConfig): PreviewStep[] {
  const answers: Answers = {};
  for (const q of config.questions) {
    if (q.channel === 'form') answers[q.key] = sampleAnswer(q);
  }

  const context = (): RenderContext => ({
    config,
    name: SAMPLE_NAME,
    businessName: SAMPLE_BUSINESS,
    answers,
  });
  const steps: PreviewStep[] = [{ from: 'customer', text: 'Hi' }];

  for (let guard = 0; guard < config.questions.length + 1; guard++) {
    const q = nextWhatsAppQuestion(config.questions, answers);
    if (!q) break;
    if (BOOKING_TYPES.includes(q.type)) {
      const what = { pick_resource: 'who or what', pick_slot: 'a time', pick_event: 'an event' }[
        q.type as 'pick_resource' | 'pick_slot' | 'pick_event'
      ];
      steps.push({ from: 'note', text: `The bot offers ${what} from live availability.` });
      answers[q.key] = q.type === 'pick_slot' ? 'slot' : 'choice';
      continue;
    }
    const message = questionMessage(q, context());
    steps.push({ from: 'bot', message }, { from: 'customer', text: replyTo(q, message) });
    answers[q.key] = sampleAnswer(q);
  }

  steps.push({
    from: 'bot',
    message: {
      kind: 'text',
      body: renderPlaceholders(config.settings.confirmation, {
        ...placeholderContext(context()),
        booking: SAMPLE_BOOKING,
      }),
    },
  });
  return steps;
}
