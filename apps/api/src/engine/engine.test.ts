import {
  clinicExample,
  validateCampaign,
  type CampaignConfigInput,
  type InboundMessage,
} from '@leadgen/shared';
import { describe, expect, it } from 'vitest';
import { advance, type EngineLead } from './engine.js';

function configOf(input: CampaignConfigInput) {
  const result = validateCampaign(input);
  if (!result.valid) throw new Error(JSON.stringify(result.issues));
  return result.config;
}

const survey = configOf({
  questions: [
    {
      id: 'budget',
      key: 'budget',
      type: 'single_choice',
      channel: 'whatsapp',
      prompt: 'Budget, {{name}}?',
      options: [
        { id: 'low', label: 'Low' },
        { id: 'mid', label: 'Mid' },
        { id: 'high', label: 'High' },
      ],
    },
    {
      id: 'size',
      key: 'size',
      type: 'single_choice',
      channel: 'whatsapp',
      prompt: 'Size?',
      options: ['s', 'm', 'l', 'xl'].map((id) => ({ id, label: id.toUpperCase() })),
    },
    { id: 'when', key: 'when', type: 'date', channel: 'whatsapp', prompt: 'Start date?' },
    { id: 'party', key: 'party', type: 'party_size', channel: 'whatsapp', prompt: 'How many?' },
    { id: 'ok', key: 'ok', type: 'yes_no', channel: 'whatsapp', prompt: 'Sure?' },
    { id: 'notes', key: 'notes', type: 'short_text', channel: 'form', prompt: 'Notes' },
  ],
  settings: {
    goal: 'lead',
    confirmation: 'Thanks {{name}}! Budget: {{answers.budget}}, size {{answers.size}}.',
  },
});

const lead = (over: Partial<EngineLead> = {}): EngineLead => ({
  name: 'Asha',
  status: 'new',
  answers: {},
  currentQuestionId: null,
  flowState: {},
  ...over,
});

const reply = (id: string, title = ''): InboundMessage => ({ kind: 'reply', id, title });
const text = (body: string): InboundMessage => ({ kind: 'text', body });
const run = (l: EngineLead, message: InboundMessage, config = survey) =>
  advance({ lead: l, config, businessName: 'Acme', message });

describe('starting', () => {
  it('asks the first question on the first message, personalised', async () => {
    const r = await run(lead(), text('Hi'));
    expect(r.lead).toMatchObject({ status: 'in_conversation', currentQuestionId: 'budget' });
    expect(r.events).toEqual([{ type: 'first_reply' }]);
    expect(r.outbound).toHaveLength(1);
    expect(r.outbound[0]).toMatchObject({ kind: 'list', body: 'Budget, Asha?' });
  });

  it('skips questions the form already answered', async () => {
    const r = await run(lead({ answers: { budget: 'mid', size: 'm' } }), text('Hi'));
    expect(r.lead.currentQuestionId).toBe('when');
    expect(r.outbound[0]).toMatchObject({ kind: 'text' });
  });

  it('completes straight away when the form answered everything', async () => {
    const r = await run(
      lead({ answers: { budget: 'mid', size: 'm', when: 'x', party: 2, ok: 'yes' } }),
      text('Hi'),
    );
    expect(r.lead.status).toBe('completed');
    expect(r.outbound).toEqual([{ kind: 'text', body: 'Thanks Asha! Budget: Mid, size M.' }]);
    expect(r.events.map((e) => e.type)).toEqual(['first_reply', 'completed']);
  });
});

describe('asking', () => {
  it('uses buttons for up to three choices and a list beyond that, with a human option when it fits', async () => {
    const budget = (await run(lead(), text('Hi'))).outbound[0]!;
    expect(budget.kind).toBe('list'); // 3 choices + human = 4 rows
    expect('options' in budget && budget.options.map((o) => o.id)).toEqual([
      'budget:low',
      'budget:mid',
      'budget:high',
      'budget:__human',
    ]);

    const yesNo = (
      await run(
        lead({
          status: 'in_conversation',
          currentQuestionId: 'party',
          answers: { budget: 'a', size: 'a', when: 'x' },
        }),
        reply('party:3'),
      )
    ).outbound[0]!;
    expect(yesNo.kind).toBe('buttons'); // Yes, No, human
    expect('options' in yesNo && yesNo.options.map((o) => o.id)).toEqual([
      'ok:yes',
      'ok:no',
      'ok:__human',
    ]);
  });

  it('leaves out the human option on a full list', async () => {
    const config = configOf({
      questions: [
        {
          id: 'pick',
          key: 'pick',
          type: 'single_choice',
          channel: 'whatsapp',
          prompt: 'Pick',
          options: Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, label: `Opt ${i}` })),
        },
      ],
      settings: { confirmation: 'ok' },
    });
    const m = (await run(lead(), text('hi'), config)).outbound[0]!;
    expect('options' in m && m.options).toHaveLength(10);
  });

  it('offers party sizes 1-10 as a list', async () => {
    const m = (
      await run(
        lead({
          status: 'in_conversation',
          currentQuestionId: 'when',
          answers: { budget: 'a', size: 'a' },
        }),
        text('31/12/2026'),
      )
    ).outbound[0]!;
    expect(m.kind).toBe('list');
    expect('options' in m && m.options.slice(0, 2).map((o) => o.title)).toEqual(['1', '2']);
  });
});

describe('answering', () => {
  const at = (id: string, answers = {}) =>
    lead({ status: 'in_conversation', currentQuestionId: id, answers });

  it('stores a tapped choice and moves on', async () => {
    const r = await run(at('budget'), reply('budget:mid', 'Mid'));
    expect(r.lead.answers).toEqual({ budget: 'mid' });
    expect(r.lead.currentQuestionId).toBe('size');
    expect(r.events).toEqual([{ type: 'answered', questionId: 'budget' }]);
  });

  it('accepts a typed label for a choice', async () => {
    expect((await run(at('budget'), text('high'))).lead.answers).toEqual({ budget: 'high' });
  });

  it('normalises typed dates and party sizes', async () => {
    expect(
      (await run(at('when', { budget: 'a', size: 'a' }), text('5/3/2027'))).lead.answers.when,
    ).toBe('2027-03-05');
    expect(
      (await run(at('party', { budget: 'a', size: 'a', when: 'x' }), reply('party:4'))).lead.answers
        .party,
    ).toBe(4);
  });

  it('nudges and re-asks on free text where a choice is expected', async () => {
    const r = await run(at('budget'), text('lots'));
    expect(r.lead.answers).toEqual({});
    expect(r.lead.currentQuestionId).toBe('budget');
    expect(r.outbound).toHaveLength(1);
    expect(r.outbound[0]!.kind).toBe('list');
    expect(r.outbound[0]!.body).toContain('Please pick one of the options below.');
    expect(r.outbound[0]!.body).toContain('Budget, Asha?');
    expect(r.events).toEqual([]);
  });

  it('nudges on a tap from an earlier message', async () => {
    const r = await run(at('size', { budget: 'mid' }), reply('budget:high'));
    expect(r.lead.answers).toEqual({ budget: 'mid' });
    expect(r.lead.currentQuestionId).toBe('size');
    expect(r.outbound[0]!.body).toContain('Size?');
  });

  it('nudges on a tapped button where text is expected, and on media', async () => {
    const base = at('when', { budget: 'a', size: 'a' });
    expect((await run(base, reply('size:m'))).lead.currentQuestionId).toBe('when');
    const media = await run(base, { kind: 'other', type: 'image' });
    expect(media.outbound[0]).toMatchObject({ kind: 'text' });
    expect(media.outbound[0]!.body).toContain('Start date?');
  });

  it('nudges on an invalid date', async () => {
    const r = await run(at('when', { budget: 'a', size: 'a' }), text('tomorrow'));
    expect(r.lead.answers.when).toBeUndefined();
    expect(r.outbound[0]!.body).toContain('Start date?');
  });

  it('finishes with the rendered confirmation', async () => {
    const r = await run(
      at('ok', { budget: 'mid', size: 'm', when: 'x', party: 2 }),
      reply('ok:yes'),
    );
    expect(r.lead).toMatchObject({ status: 'completed', currentQuestionId: null });
    expect(r.outbound).toEqual([{ kind: 'text', body: 'Thanks Asha! Budget: Mid, size M.' }]);
    expect(r.events.map((e) => e.type)).toEqual(['answered', 'completed']);
  });

  it('does not mutate the lead it was given', async () => {
    const input = at('budget');
    await run(input, reply('budget:mid'));
    expect(input.answers).toEqual({});
    expect(input.currentQuestionId).toBe('budget');
  });
});

describe('handing off to a person', () => {
  const at = lead({ status: 'in_conversation', currentQuestionId: 'budget' });

  it.each([
    ['the handoff option', reply('budget:__human')],
    ['a keyword', text('human')],
    ['a keyword in a sentence', text('Can I talk to a Human please?')],
    ['another keyword', text('AGENT!')],
  ])('pauses the bot on %s', async (_label, message) => {
    const r = await run(at, message);
    expect(r.lead).toMatchObject({
      status: 'needs_human',
      botPaused: true,
      currentQuestionId: null,
    });
    expect(r.outbound).toEqual([
      { kind: 'text', body: 'No problem, someone from Acme will reply here shortly.' },
    ]);
    expect(r.events).toEqual([{ type: 'handoff', questionId: 'budget' }]);
  });

  it('works as the very first message too', async () => {
    const r = await run(lead(), text('human'));
    expect(r.lead.status).toBe('needs_human');
  });

  it('does not trigger on look-alike words', async () => {
    expect((await run(at, text('humane'))).lead.status).toBe('in_conversation');
  });
});

describe('booking questions', () => {
  it('hands over to a person until the booking flow exists', async () => {
    const config = configOf(clinicExample);
    const r = await run(
      lead({
        status: 'in_conversation',
        currentQuestionId: 'first_visit',
        answers: { reason: 'skin' },
      }),
      reply('first_visit:yes'),
      config,
    );
    expect(r.lead.status).toBe('needs_human');
    expect(r.events.map((e) => e.type)).toEqual(['answered', 'handoff']);
  });
});
