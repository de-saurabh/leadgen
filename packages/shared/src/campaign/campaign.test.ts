import { describe, expect, it } from 'vitest';
import { WHATSAPP_LIMITS } from '../whatsapp/limits.js';
import { displayAnswers, extractPlaceholders, renderPlaceholders } from '../placeholders.js';
import { nextWhatsAppQuestion, parseAnswer, pendingWhatsAppQuestions } from './answers.js';
import type { CampaignConfig, CampaignConfigInput } from './config.js';
import { parseDate } from './date.js';
import { EXAMPLE_CAMPAIGNS, clinicExample, leadExample, pubExample } from './examples.js';
import { handoffFits, resolveWhatsAppRender, type Question } from './questions.js';
import { validateCampaign } from './validate.js';

function mustBeValid(input: unknown): CampaignConfig {
  const result = validateCampaign(input);
  if (!result.valid) throw new Error(JSON.stringify(result.issues));
  return result.config;
}

/** A copy of an example with `change` applied, for invalid-config cases. */
function variant(
  base: CampaignConfigInput,
  change: (draft: CampaignConfigInput) => void,
): CampaignConfigInput {
  const draft = JSON.parse(JSON.stringify(base)) as CampaignConfigInput;
  change(draft);
  return draft;
}

const errorsOf = (input: unknown) =>
  validateCampaign(input).issues.filter((i) => i.severity === 'error');

describe('example campaigns', () => {
  it.each(Object.entries(EXAMPLE_CAMPAIGNS))('%s validates with no errors', (_name, example) => {
    expect(errorsOf(example)).toEqual([]);
  });

  it('applies defaults', () => {
    const config = mustBeValid(leadExample);
    expect(config.settings.openingTemplate).toEqual({
      name: 'hello_world',
      language: 'en_US',
      params: [],
    });
    expect(config.settings.reminderOffsets).toEqual([180]);
    expect(config.questions[0]?.required).toBe(true);
  });
});

describe('question rules', () => {
  const clinic = (change: (d: CampaignConfigInput) => void) =>
    errorsOf(variant(clinicExample, change));

  it('rejects duplicate ids and keys', () => {
    const messages = clinic((d) => {
      d.questions.push({ ...d.questions[0]! });
    }).map((e) => e.message);
    expect(messages.some((m) => m.includes('used twice'))).toBe(true);
  });

  it('rejects reserved keys', () => {
    expect(clinic((d) => (d.questions[0]!.key = 'phone')).map((e) => e.path)).toContain(
      'questions.0.key',
    );
  });

  it('rejects ids that would break reply-id encoding', () => {
    expect(clinic((d) => (d.questions[0]!.id = 'a:b')).length).toBeGreaterThan(0);
  });

  it('keeps multi-choice and booking questions out of the wrong channel', () => {
    const multi = clinic((d) => {
      d.questions[0]!.type = 'multi_choice';
      d.questions[0]!.channel = 'whatsapp';
    });
    expect(multi.map((e) => e.path)).toContain('questions.0.channel');
    const slotInForm = clinic((d) => (d.questions[3]!.channel = 'form'));
    expect(slotInForm.map((e) => e.path)).toContain('questions.3.channel');
  });

  it('needs at least two choices for choice questions', () => {
    expect(
      clinic((d) => (d.questions[0]!.options = [{ id: 'a', label: 'A' }])).length,
    ).toBeGreaterThan(0);
  });

  it('rejects options on types that take none', () => {
    expect(
      clinic((d) => (d.questions[1]!.options = [{ id: 'a', label: 'A' }])).map((e) => e.path),
    ).toContain('questions.1.options');
  });

  it('allows more than 10 choices in the form but not in WhatsApp', () => {
    const choices = Array.from({ length: 11 }, (_, i) => ({ id: `c${i}`, label: `Choice ${i}` }));
    const inForm = errorsOf(
      variant(leadExample, (d) => {
        d.questions[0]!.channel = 'form';
        d.questions[0]!.options = choices;
      }),
    );
    const inWhatsApp = errorsOf(variant(leadExample, (d) => (d.questions[0]!.options = choices)));
    expect(inForm).toEqual([]);
    expect(inWhatsApp.map((e) => e.message).join()).toContain('at most 10');
  });
});

describe('WhatsApp limits', () => {
  const withOptions = (labels: string[]) =>
    variant(leadExample, (d) => {
      d.questions[0]!.options = labels.map((label, i) => ({ id: `o${i}`, label }));
    });

  it('accepts exactly 3 buttons of 20 characters', () => {
    const label = 'x'.repeat(WHATSAPP_LIMITS.replyButtons.titleMaxLength);
    expect(errorsOf(withOptions([label, 'B', 'C']))).toEqual([]);
  });

  it('rejects a button title over 20 characters', () => {
    const label = 'x'.repeat(WHATSAPP_LIMITS.replyButtons.titleMaxLength + 1);
    expect(errorsOf(withOptions([label, 'B', 'C'])).length).toBe(1);
  });

  it('lets a list row use 24 characters but not 25', () => {
    const ok = 'x'.repeat(WHATSAPP_LIMITS.list.rowTitleMaxLength);
    expect(errorsOf(withOptions([ok, 'B', 'C', 'D']))).toEqual([]);
    expect(errorsOf(withOptions([`${ok}x`, 'B', 'C', 'D'])).length).toBe(1);
  });

  it('rejects an interactive prompt over 1024 characters but allows a long text prompt', () => {
    const long = 'x'.repeat(WHATSAPP_LIMITS.interactiveBodyMaxLength + 1);
    expect(errorsOf(variant(leadExample, (d) => (d.questions[0]!.prompt = long))).length).toBe(1);
    const asText = variant(leadExample, (d) => {
      d.questions[0]!.type = 'short_text';
      delete d.questions[0]!.options;
      d.questions[0]!.prompt = long;
    });
    expect(errorsOf(asText)).toEqual([]);
  });

  it('rejects a row description over 72 characters', () => {
    const input = withOptions(['A', 'B', 'C', 'D']);
    input.questions[0]!.options![0]!.description = 'x'.repeat(73);
    expect(errorsOf(input).length).toBe(1);
  });

  it('picks buttons, list or invalid by option count', () => {
    const q = (n: number): Question => ({
      id: 'q',
      key: 'q',
      type: 'single_choice',
      channel: 'whatsapp',
      prompt: 'p',
      required: true,
      options: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: 'x' })),
    });
    expect(resolveWhatsAppRender(q(3)).mode).toBe('buttons');
    expect(resolveWhatsAppRender(q(4)).mode).toBe('list');
    expect(resolveWhatsAppRender(q(10)).mode).toBe('list');
    expect(resolveWhatsAppRender(q(11)).mode).toBe('invalid');
  });

  it('only adds a human option where there is room', () => {
    expect(handoffFits(2)).toBe(true);
    expect(handoffFits(9)).toBe(true);
    expect(handoffFits(10)).toBe(false);
  });
});

describe('booking rules', () => {
  const clinic = (change: (d: CampaignConfigInput) => void) =>
    errorsOf(variant(clinicExample, change)).map((e) => e.message);

  it('rejects booking questions in a lead campaign', () => {
    expect(
      errorsOf(variant(clinicExample, (d) => (d.settings.goal = 'lead'))).length,
    ).toBeGreaterThan(0);
  });

  it('needs exactly one slot or event question', () => {
    expect(clinic((d) => d.questions.pop()).join()).toContain('exactly one');
  });

  it('needs pick_resource before pick_slot when customers pick', () => {
    expect(clinic((d) => (d.questions = [d.questions[3]!, d.questions[2]!])).join()).toContain(
      'pick_resource before pick_slot',
    );
    expect(clinic((d) => d.questions.splice(2, 1)).join()).toContain('pick_resource before');
  });

  it('forbids pick_resource when auto-assigning', () => {
    expect(clinic((d) => (d.settings.resourceSelection = 'auto_assign')).join()).toContain(
      'auto-assigned',
    );
  });

  it('forbids a resource question next to an event', () => {
    expect(
      errorsOf(variant(pubExample, (d) => d.questions.push({ ...clinicExample.questions[2]! })))
        .length,
    ).toBeGreaterThan(0);
  });

  it('requires a party_size question to count party size', () => {
    expect(
      errorsOf(variant(pubExample, (d) => (d.questions = d.questions.slice(1)))).map((e) => e.path),
    ).toContain('settings.countPartySize');
  });

  it('warns, but does not block, when reminders have no template', () => {
    const result = validateCampaign(
      variant(clinicExample, (d) => delete d.settings.reminderTemplate),
    );
    expect(result.valid).toBe(true);
    expect(result.issues.map((i) => i.severity)).toEqual(['warning']);
  });

  it('rejects duplicate reminder times', () => {
    expect(clinic((d) => (d.settings.reminderOffsets = [60, 60])).join()).toContain(
      'only appear once',
    );
  });
});

describe('structural errors', () => {
  it('reports schema problems with a path', () => {
    const result = validateCampaign({ questions: [{ id: 'A B' }], settings: {} });
    expect(result.valid).toBe(false);
    expect(result.issues.every((i) => i.severity === 'error' && i.path !== '')).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(validateCampaign(null).valid).toBe(false);
    expect(validateCampaign('nope').valid).toBe(false);
  });
});

describe('placeholders', () => {
  it('extracts tokens case-insensitively and tolerates spaces', () => {
    expect(extractPlaceholders('Hi {{ Name }}, {{answers.x}}!')).toEqual(['name', 'answers.x']);
  });

  it('renders known values and blanks the rest', () => {
    const out = renderPlaceholders('{{name}} @ {{business}} {{answers.a}}{{answers.b}}{{nope}}', {
      name: 'Asha',
      business: 'Clinic',
      answers: { a: 'one' },
    });
    expect(out).toBe('Asha @ Clinic one');
  });

  it('renders booking details', () => {
    expect(
      renderPlaceholders('{{booking.resource}} {{booking.date}} {{booking.time}}', {
        booking: { resource: 'Dr Rao', date: '1 Nov', time: '10:00' },
      }),
    ).toBe('Dr Rao 1 Nov 10:00');
  });

  it('flags unknown placeholders, and booking ones in lead campaigns', () => {
    const unknown = errorsOf(
      variant(leadExample, (d) => (d.settings.confirmation = 'Hi {{nickname}}')),
    );
    expect(unknown.map((e) => e.message).join()).toContain('{{nickname}}');
    const missingKey = errorsOf(
      variant(leadExample, (d) => (d.settings.confirmation = '{{answers.zzz}}')),
    );
    expect(missingKey.length).toBe(1);
    const booking = errorsOf(
      variant(leadExample, (d) => (d.settings.confirmation = '{{booking.time}}')),
    );
    expect(booking.map((e) => e.message).join()).toContain('booking campaigns');
  });

  it('validates placeholders in template params', () => {
    const input = variant(
      clinicExample,
      (d) => (d.settings.reminderTemplate!.params = ['{{who}}']),
    );
    expect(errorsOf(input).map((e) => e.path)).toContain('settings.reminderTemplate.params.0');
  });

  it('shows labels instead of stored ids', () => {
    const config = mustBeValid(clinicExample);
    expect(
      displayAnswers(config.questions, { reason: 'skin', first_visit: 'yes', extra: ['a'] }),
    ).toEqual({ reason: 'Skin', first_visit: 'Yes', extra: 'a' });
  });
});

describe('skipping answered questions', () => {
  const config = mustBeValid(clinicExample);

  it('asks WhatsApp questions in order', () => {
    expect(pendingWhatsAppQuestions(config.questions, {}).map((q) => q.id)).toEqual([
      'first_visit',
      'doctor',
      'slot',
    ]);
    expect(nextWhatsAppQuestion(config.questions, {})?.id).toBe('first_visit');
  });

  it('skips a WhatsApp question the form already answered', () => {
    expect(nextWhatsAppQuestion(config.questions, { first_visit: 'no' })?.id).toBe('doctor');
  });

  it('never asks form questions in WhatsApp', () => {
    const ids = pendingWhatsAppQuestions(config.questions, {}).map((q) => q.id);
    expect(ids).not.toContain('reason');
  });

  it('treats blank and empty answers as unanswered, and false/0 as answered', () => {
    expect(nextWhatsAppQuestion(config.questions, { first_visit: '  ' })?.id).toBe('first_visit');
    expect(nextWhatsAppQuestion(config.questions, { first_visit: false })?.id).toBe('doctor');
  });

  it('returns nothing once everything is answered', () => {
    expect(
      nextWhatsAppQuestion(config.questions, { first_visit: 'yes', doctor: 'd1', slot: 's1' }),
    ).toBeUndefined();
  });
});

describe('parseAnswer', () => {
  const config = mustBeValid({
    questions: [
      { id: 'a', key: 'a', type: 'short_text', channel: 'form', prompt: 'p' },
      { id: 'b', key: 'b', type: 'email', channel: 'form', prompt: 'p' },
      { id: 'c', key: 'c', type: 'number', channel: 'form', prompt: 'p' },
      { id: 'd', key: 'd', type: 'date', channel: 'form', prompt: 'p' },
      {
        id: 'e',
        key: 'e',
        type: 'single_choice',
        channel: 'form',
        prompt: 'p',
        options: [
          { id: 'x', label: 'Ex' },
          { id: 'y', label: 'Why' },
        ],
      },
      {
        id: 'f',
        key: 'f',
        type: 'multi_choice',
        channel: 'form',
        prompt: 'p',
        options: [
          { id: 'x', label: 'Ex' },
          { id: 'y', label: 'Why' },
        ],
      },
      { id: 'g', key: 'g', type: 'party_size', channel: 'form', prompt: 'p' },
      { id: 'h', key: 'h', type: 'yes_no', channel: 'form', prompt: 'p', required: false },
    ],
    settings: { confirmation: 'ok' },
  });
  const q = (id: string) => config.questions.find((x) => x.id === id)!;

  it('trims text and enforces required', () => {
    expect(parseAnswer(q('a'), '  hi ')).toEqual({ ok: true, value: 'hi' });
    expect(parseAnswer(q('a'), '   ').ok).toBe(false);
    expect(parseAnswer(q('h'), '')).toEqual({ ok: true, value: '' });
  });

  it('validates email and numbers', () => {
    expect(parseAnswer(q('b'), 'a@b.co').ok).toBe(true);
    expect(parseAnswer(q('b'), 'nope').ok).toBe(false);
    expect(parseAnswer(q('c'), '4.5')).toEqual({ ok: true, value: 4.5 });
    expect(parseAnswer(q('c'), 'abc').ok).toBe(false);
  });

  it('normalises dates and rejects impossible ones', () => {
    expect(parseAnswer(q('d'), '5/3/2027')).toEqual({ ok: true, value: '2027-03-05' });
    expect(parseAnswer(q('d'), '2027-02-30').ok).toBe(false);
    expect(parseDate('31.12.2026')).toBe('2026-12-31');
    expect(parseDate('2028-02-29')).toBe('2028-02-29');
    expect(parseDate('2027-02-29')).toBeUndefined();
    expect(parseDate('tomorrow')).toBeUndefined();
  });

  it('matches choices by id or label and stores the id', () => {
    expect(parseAnswer(q('e'), 'y')).toEqual({ ok: true, value: 'y' });
    expect(parseAnswer(q('e'), 'why')).toEqual({ ok: true, value: 'y' });
    expect(parseAnswer(q('e'), 'z').ok).toBe(false);
    expect(parseAnswer(q('h'), 'Yes')).toEqual({ ok: true, value: 'yes' });
  });

  it('handles multi-choice lists, deduping and rejecting strangers', () => {
    expect(parseAnswer(q('f'), ['x', 'Ex', 'y'])).toEqual({ ok: true, value: ['x', 'y'] });
    expect(parseAnswer(q('f'), ['q']).ok).toBe(false);
    expect(parseAnswer(q('f'), []).ok).toBe(false);
  });

  it('accepts whole-number party sizes only', () => {
    expect(parseAnswer(q('g'), '4')).toEqual({ ok: true, value: 4 });
    expect(parseAnswer(q('g'), '0').ok).toBe(false);
    expect(parseAnswer(q('g'), '2.5').ok).toBe(false);
  });

  it('refuses to parse booking answers', () => {
    const slot = mustBeValid(clinicExample).questions[3]!;
    expect(parseAnswer(slot, 'whatever').ok).toBe(false);
  });
});
