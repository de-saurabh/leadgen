import type { Answers } from '../campaign/questions.js';
import type { CampaignConfig } from '../campaign/config.js';
import { handoffFits, optionsOf, type Question } from '../campaign/questions.js';
import { displayAnswers, renderPlaceholders, type PlaceholderContext } from '../placeholders.js';
import { WHATSAPP_LIMITS, interactiveKindFor } from './limits.js';
import { HANDOFF_MARKER, replyId, type ChoiceOption, type OutboundMessage } from './messages.js';

export interface RenderContext {
  config: CampaignConfig;
  name: string;
  businessName: string;
  answers: Answers;
}

const LIST_BUTTON_TEXT = 'Choose';
const MAX_PARTY_ROWS = WHATSAPP_LIMITS.list.maxRows;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function placeholderContext(ctx: RenderContext): PlaceholderContext {
  return {
    name: ctx.name,
    business: ctx.businessName,
    answers: displayAnswers(ctx.config.questions, ctx.answers),
  };
}

export function renderText(text: string, ctx: RenderContext): string {
  return renderPlaceholders(text, placeholderContext(ctx));
}

/** The fixed choices for a question asked as buttons/list, or `undefined` for free-text ones. */
function choicesFor(q: Question): ChoiceOption[] | undefined {
  switch (q.type) {
    case 'single_choice':
    case 'yes_no':
      return optionsOf(q).map((o) => ({
        id: replyId(q.id, o.id),
        title: o.label,
        description: o.description,
      }));
    case 'party_size':
      return Array.from({ length: MAX_PARTY_ROWS }, (_, i) => ({
        id: replyId(q.id, String(i + 1)),
        title: String(i + 1),
      }));
    default:
      return undefined;
  }
}

const TEXT_HINTS: Partial<Record<Question['type'], string>> = {
  date: 'Reply with a date like 31/12/2026.',
  email: 'Reply with your email address.',
  number: 'Reply with a number.',
};

/** Builds the message that asks `question`. `nudge` prefixes the "please pick" reminder. */
export function questionMessage(
  q: Question,
  ctx: RenderContext,
  opts: { nudge?: boolean } = {},
): OutboundMessage {
  const { settings } = ctx.config;
  const prompt = renderText(q.prompt, ctx);
  const lead = opts.nudge ? `${renderText(settings.nudge, ctx)}\n\n` : '';
  const choices = choicesFor(q);

  if (!choices) {
    const hint = TEXT_HINTS[q.type];
    return {
      kind: 'text',
      body: clip(`${lead}${prompt}${hint ? `\n\n${hint}` : ''}`, WHATSAPP_LIMITS.textBodyMaxLength),
    };
  }

  const options = handoffFits(choices.length)
    ? [...choices, { id: replyId(q.id, HANDOFF_MARKER), title: settings.handoff.label }]
    : choices;
  const body = clip(`${lead}${prompt}`, WHATSAPP_LIMITS.interactiveBodyMaxLength);
  const kind = interactiveKindFor(options.length);

  if (kind === 'buttons') {
    return {
      kind,
      body,
      options: options.map((o) => ({
        id: o.id,
        title: clip(o.title, WHATSAPP_LIMITS.replyButtons.titleMaxLength),
      })),
    };
  }
  return {
    kind: 'list',
    body,
    buttonText: LIST_BUTTON_TEXT,
    options: options.map((o) => ({
      id: o.id,
      title: clip(o.title, WHATSAPP_LIMITS.list.rowTitleMaxLength),
      description:
        o.description && clip(o.description, WHATSAPP_LIMITS.list.rowDescriptionMaxLength),
    })),
  };
}
