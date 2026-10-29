import { parseDate } from './date.js';
import {
  optionsOf,
  type AnswerValue,
  type Answers,
  type Question,
  type QuestionOption,
} from './questions.js';

export type ParsedAnswer = { ok: true; value: AnswerValue } | { ok: false; reason: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether the lead has already given an answer for this key (so the bot skips it). */
export function isAnswered(answers: Answers, key: string): boolean {
  const value = answers[key];
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** WhatsApp questions still to ask, in order, skipping any already answered in the form. */
export function pendingWhatsAppQuestions(
  questions: readonly Question[],
  answers: Answers,
): Question[] {
  return questions.filter((q) => q.channel === 'whatsapp' && !isAnswered(answers, q.key));
}

export function nextWhatsAppQuestion(
  questions: readonly Question[],
  answers: Answers,
): Question | undefined {
  return pendingWhatsAppQuestions(questions, answers)[0];
}

function findOption(question: Question, raw: string): QuestionOption | undefined {
  const text = raw.trim().toLowerCase();
  return optionsOf(question).find((o) => o.id === raw.trim() || o.label.toLowerCase() === text);
}

/**
 * Checks and normalises one raw answer (a form field or a typed WhatsApp reply).
 * Choices are matched by id first, then by label, and stored as the option id.
 * Booking questions are answered by the engine from availability, never parsed here.
 */
export function parseAnswer(question: Question, raw: string | readonly string[]): ParsedAnswer {
  if (question.type === 'multi_choice') {
    const items = (Array.isArray(raw) ? raw : [raw]).map((r) => String(r));
    const ids: string[] = [];
    for (const item of items.filter((i) => i.trim() !== '')) {
      const option = findOption(question, item);
      if (!option) return { ok: false, reason: 'Pick from the listed choices.' };
      if (!ids.includes(option.id)) ids.push(option.id);
    }
    if (ids.length === 0 && question.required) return { ok: false, reason: 'Pick at least one.' };
    return { ok: true, value: ids };
  }

  const text = (Array.isArray(raw) ? (raw[0] ?? '') : (raw as string)).trim();
  if (text === '') {
    return question.required ? { ok: false, reason: 'This is required.' } : { ok: true, value: '' };
  }

  switch (question.type) {
    case 'short_text':
      return text.length <= 200
        ? { ok: true, value: text }
        : { ok: false, reason: 'Keep it under 200 characters.' };
    case 'long_text':
      return text.length <= 2000
        ? { ok: true, value: text }
        : { ok: false, reason: 'Keep it under 2000 characters.' };
    case 'email':
      return EMAIL.test(text)
        ? { ok: true, value: text }
        : { ok: false, reason: 'Enter a valid email.' };
    case 'number': {
      const value = Number(text);
      return text !== '' && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, reason: 'Enter a number.' };
    }
    case 'date': {
      const date = parseDate(text);
      return date
        ? { ok: true, value: date }
        : { ok: false, reason: 'Enter a date like 31/12/2026.' };
    }
    case 'party_size': {
      const value = Number(text);
      return Number.isInteger(value) && value >= 1 && value <= 100
        ? { ok: true, value }
        : { ok: false, reason: 'Enter how many people (1–100).' };
    }
    case 'single_choice':
    case 'yes_no': {
      const option = findOption(question, text);
      return option
        ? { ok: true, value: option.id }
        : { ok: false, reason: 'Pick one of the choices.' };
    }
    default:
      return { ok: false, reason: `${question.type} is answered by the bot, not typed.` };
  }
}
