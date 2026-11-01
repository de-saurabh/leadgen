import {
  BOOKING_TYPES,
  HANDOFF_MARKER,
  parseReplyId,
  questionMessage,
  renderText,
  nextWhatsAppQuestion,
  parseAnswer,
  type Answers,
  type CampaignConfig,
  type InboundMessage,
  type OutboundMessage,
  type RenderContext,
  type Question,
} from '@leadgen/shared';
import type { LeadEventType, LeadStatus } from '../db/schema/leads.js';

export interface EngineLead {
  name: string;
  status: LeadStatus;
  answers: Answers;
  currentQuestionId: string | null;
}

export interface EngineInput {
  lead: EngineLead;
  config: CampaignConfig;
  businessName: string;
  message: InboundMessage;
}

export interface EngineResult {
  /** The lead's new state; the caller persists it. */
  lead: EngineLead & { botPaused: boolean };
  /** Messages to send, in order. */
  outbound: OutboundMessage[];
  events: Array<{ type: LeadEventType; questionId?: string }>;
}

function wantsHuman(message: InboundMessage, keywords: readonly string[]): boolean {
  if (message.kind === 'reply') return parseReplyId(message.id)?.optionId === HANDOFF_MARKER;
  if (message.kind !== 'text') return false;
  const words = message.body
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const text = words.join(' ');
  return keywords.some((keyword) => {
    const k = keyword
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .join(' ');
    return k !== '' && (text === k || ` ${text} `.includes(` ${k} `));
  });
}

/** Reads the customer's reply as an answer to `question`, or undefined when it doesn't fit. */
function answerFrom(question: Question, message: InboundMessage): Answers[string] | undefined {
  let raw: string;
  if (message.kind === 'reply') {
    const parsed = parseReplyId(message.id);
    // A tap on an older message belongs to another question.
    if (!parsed || parsed.questionId !== question.id) return undefined;
    raw = parsed.optionId;
  } else if (message.kind === 'text') {
    raw = message.body;
  } else {
    return undefined;
  }
  const result = parseAnswer(question, raw);
  return result.ok ? result.value : undefined;
}

/**
 * Advances a conversation by one customer message. Pure: reads the state it is given and
 * says what should change and what to send, so the caller can apply it atomically.
 */
export function advance({ lead, config, businessName, message }: EngineInput): EngineResult {
  const { settings, questions } = config;
  const result: EngineResult = {
    lead: { ...lead, answers: { ...lead.answers }, botPaused: false },
    outbound: [],
    events: [],
  };
  const render = (): RenderContext => ({
    config,
    name: lead.name,
    businessName,
    answers: result.lead.answers,
  });

  function handOff(questionId?: string) {
    result.lead.status = 'needs_human';
    result.lead.botPaused = true;
    result.lead.currentQuestionId = null;
    result.outbound.push({ kind: 'text', body: renderText(settings.handoff.ack, render()) });
    result.events.push({ type: 'handoff', ...(questionId && { questionId }) });
  }

  function askNext(): void {
    const next = nextWhatsAppQuestion(questions, result.lead.answers);
    if (!next) {
      result.lead.status = 'completed';
      result.lead.currentQuestionId = null;
      result.outbound.push({ kind: 'text', body: renderText(settings.confirmation, render()) });
      result.events.push({ type: 'completed' });
      return;
    }
    if (BOOKING_TYPES.includes(next.type)) {
      // Booking questions need the availability service (a later milestone); until then a
      // person finishes the booking rather than the customer hitting a dead end.
      handOff(next.id);
      return;
    }
    result.lead.currentQuestionId = next.id;
    result.outbound.push(questionMessage(next, render()));
  }

  if (wantsHuman(message, settings.handoff.keywords)) {
    handOff(lead.currentQuestionId ?? undefined);
    return result;
  }

  if (lead.status === 'new') {
    result.lead.status = 'in_conversation';
    result.events.push({ type: 'first_reply' });
    askNext();
    return result;
  }

  const current = questions.find((q) => q.id === lead.currentQuestionId);
  if (!current) {
    askNext();
    return result;
  }

  const answer = answerFrom(current, message);
  if (answer === undefined) {
    result.outbound.push(questionMessage(current, render(), { nudge: true }));
    return result;
  }

  result.lead.answers[current.key] = answer;
  result.events.push({ type: 'answered', questionId: current.id });
  askNext();
  return result;
}
