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
import type { BookingPort } from '../services/booking.js';
import {
  answerBooking,
  askBooking,
  bookingDisplay,
  type BookingState,
  type DialogueDeps,
  type DialogueResult,
} from './bookingDialogue.js';

export interface EngineLead {
  name: string;
  status: LeadStatus;
  answers: Answers;
  currentQuestionId: string | null;
  /** Where the customer is inside a booking question (see `BookingState`). */
  flowState: Record<string, unknown>;
}

export interface EngineInput {
  lead: EngineLead;
  config: CampaignConfig;
  businessName: string;
  message: InboundMessage;
  /** Needed only when the campaign has booking questions. */
  booking?: BookingPort | undefined;
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
const PENDING_TEXT =
  'Thanks {{name}}, your request for {{booking.date}} at {{booking.time}} has been sent to {{business}}. We will confirm it here shortly.';
const UNAVAILABLE_TEXT = 'Sorry, there is nothing available to book right now.';

export async function advance({
  lead,
  config,
  businessName,
  message,
  booking: port,
}: EngineInput): Promise<EngineResult> {
  const { settings, questions } = config;
  const result: EngineResult = {
    lead: {
      ...lead,
      answers: { ...lead.answers },
      flowState: { ...lead.flowState },
      botPaused: false,
    },
    outbound: [],
    events: [],
  };
  const render = (): RenderContext => ({
    config,
    name: lead.name,
    businessName,
    answers: result.lead.answers,
    booking: flow().booking,
  });
  /** The booking sub-state, edited in place and saved with the lead. */
  const flow = () => result.lead.flowState as BookingState;

  function handOff(questionId?: string) {
    result.lead.status = 'needs_human';
    result.lead.botPaused = true;
    result.lead.currentQuestionId = null;
    result.outbound.push({ kind: 'text', body: renderText(settings.handoff.ack, render()) });
    result.events.push({ type: 'handoff', ...(questionId && { questionId }) });
  }

  function partySize(): number {
    const q = questions.find((x) => x.type === 'party_size');
    const n = q ? Number(result.lead.answers[q.key]) : NaN;
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }

  const dialogue = (): DialogueDeps | undefined =>
    port && {
      port,
      partySize: partySize(),
      prompt: (text) => renderText(text, render()),
      handoffLabel: settings.handoff.label,
      nudge: renderText(settings.nudge, render()),
    };

  /** Applies what a booking question came back with, then moves on if it is answered. */
  async function applyDialogue(q: Question, outcome: DialogueResult): Promise<void> {
    switch (outcome.kind) {
      case 'message':
        result.lead.currentQuestionId = q.id;
        result.outbound.push(outcome.message);
        return;
      case 'none':
        result.outbound.push({ kind: 'text', body: UNAVAILABLE_TEXT });
        handOff(q.id);
        return;
      case 'skip':
        result.lead.answers[q.key] = outcome.answer;
        await askNext();
        return;
      case 'booked':
        result.lead.answers[q.key] = outcome.answer;
        flow().booking = bookingDisplay(outcome.booked, port!.timeZone);
        result.events.push(
          { type: 'answered', questionId: q.id },
          { type: 'booked', questionId: q.id },
        );
        await askNext();
        return;
    }
  }

  async function askNext(): Promise<void> {
    const next = nextWhatsAppQuestion(questions, result.lead.answers);
    if (!next) {
      const pending = flow().booking?.status === 'pending';
      result.lead.status = 'completed';
      result.lead.currentQuestionId = null;
      result.outbound.push({
        kind: 'text',
        body: renderText(pending ? PENDING_TEXT : settings.confirmation, render()),
      });
      result.events.push({ type: 'completed' });
      return;
    }
    if (BOOKING_TYPES.includes(next.type)) {
      const deps = dialogue();
      if (!deps) {
        // No availability to offer (e.g. a bare engine): a person finishes the booking.
        handOff(next.id);
        return;
      }
      await applyDialogue(next, await askBooking(next, flow(), deps));
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
    await askNext();
    return result;
  }

  const current = questions.find((q) => q.id === lead.currentQuestionId);
  if (!current) {
    await askNext();
    return result;
  }

  if (BOOKING_TYPES.includes(current.type)) {
    const deps = dialogue();
    if (!deps) {
      handOff(current.id);
      return result;
    }
    await applyDialogue(current, await answerBooking(current, flow(), message, deps));
    return result;
  }

  const answer = answerFrom(current, message);
  if (answer === undefined) {
    result.outbound.push(questionMessage(current, render(), { nudge: true }));
    return result;
  }

  result.lead.answers[current.key] = answer;
  result.events.push({ type: 'answered', questionId: current.id });
  await askNext();
  return result;
}
