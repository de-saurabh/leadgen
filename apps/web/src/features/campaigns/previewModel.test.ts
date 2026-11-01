import { clinicExample, leadExample, pubExample, restaurantExample } from '@leadgen/shared';
import { describe, expect, it } from 'vitest';
import { buildWhatsAppPreview, previewConfig, SAMPLE_NAME } from './previewModel';

const preview = (draft: Parameters<typeof previewConfig>[0]) => {
  const config = previewConfig(draft);
  if (!config) throw new Error('draft did not parse');
  return buildWhatsAppPreview(config);
};

describe('previewConfig', () => {
  it('accepts a half-finished draft by filling blanks', () => {
    const config = previewConfig({
      questions: [{ id: 'a', key: 'a', type: 'short_text', channel: 'whatsapp', prompt: '  ' }],
      settings: { goal: 'lead', confirmation: '' },
    });
    expect(config?.questions[0]?.prompt).toBe('(question text)');
    expect(config?.settings.confirmation).toBe('(confirmation message)');
  });

  it('gives up on structurally broken drafts instead of throwing', () => {
    expect(
      previewConfig({
        questions: [{ id: 'A B', key: 'a', type: 'short_text', channel: 'form', prompt: 'x' }],
        settings: { confirmation: 'ok' },
      }),
    ).toBeNull();
  });
});

describe('buildWhatsAppPreview', () => {
  it('starts with the customer saying hi and ends with the confirmation', () => {
    const steps = preview(leadExample);
    expect(steps[0]).toEqual({ from: 'customer', text: 'Hi' });
    const last = steps.at(-1);
    expect(last).toMatchObject({ from: 'bot', message: { kind: 'text' } });
    expect(JSON.stringify(last)).toContain(`Thanks ${SAMPLE_NAME}`);
  });

  it('shows WhatsApp questions personalised, with the sample customer tapping the first choice', () => {
    const steps = preview(leadExample);
    expect(steps[1]).toMatchObject({
      from: 'bot',
      message: { kind: 'list', body: `What's your budget, ${SAMPLE_NAME}?` }, // 3 choices + the human row
    });
    expect(steps[2]).toMatchObject({ from: 'customer', text: 'Under 5 lakh' });
  });

  it('leaves out questions the form already asks', () => {
    const bodies = preview(leadExample).map((s) =>
      s.from === 'bot' ? JSON.stringify(s.message) : '',
    );
    expect(bodies.join()).not.toContain('Anything we should know?');
  });

  it('uses answers from the form in later questions', () => {
    const steps = preview({
      questions: [
        {
          id: 'topic',
          key: 'topic',
          type: 'single_choice',
          channel: 'form',
          prompt: 'Topic?',
          options: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ],
        },
        {
          id: 'why',
          key: 'why',
          type: 'short_text',
          channel: 'whatsapp',
          prompt: 'Why {{answers.topic}} at {{business}}?',
        },
      ],
      settings: { confirmation: 'Got {{answers.topic}}' },
    });
    expect(JSON.stringify(steps)).toContain('Why Alpha at Your Business?');
    expect(JSON.stringify(steps.at(-1))).toContain('Got Alpha');
  });

  it('describes booking questions as live availability', () => {
    const notes = preview(clinicExample).filter((s) => s.from === 'note');
    expect(notes.map((n) => n.from === 'note' && n.text)).toEqual([
      'The bot offers who or what from live availability.',
      'The bot offers a time from live availability.',
    ]);
    const confirmation = JSON.stringify(preview(clinicExample).at(-1));
    expect(confirmation).toContain('Dr. Sample');
    expect(confirmation).toContain('10:30');
  });

  it('works for every example campaign', () => {
    for (const draft of [leadExample, clinicExample, restaurantExample, pubExample]) {
      const steps = preview(draft);
      expect(steps.length).toBeGreaterThan(1);
      expect(steps.at(-1)?.from).toBe('bot');
    }
  });

  it('renders a party-size list and picks 2', () => {
    const config = previewConfig({
      questions: [
        { id: 'p', key: 'p', type: 'party_size', channel: 'whatsapp', prompt: 'How many?' },
      ],
      settings: { confirmation: 'Table for {{answers.p}}' },
    })!;
    const steps = buildWhatsAppPreview(config);
    expect(steps[1]).toMatchObject({ from: 'bot', message: { kind: 'list' } });
    expect(steps[2]).toEqual({ from: 'customer', text: '2' });
    expect(JSON.stringify(steps.at(-1))).toContain('Table for 2');
  });
});
