import { describe, expect, it } from 'vitest';
import { validateCampaign } from '@leadgen/shared';
import {
  changeType,
  emptyDraft,
  issuesForCampaign,
  issuesForQuestion,
  moveItem,
  newQuestion,
  optionIdFor,
  slugKey,
  uniqueId,
} from './draft';

describe('slugKey', () => {
  it.each([
    ["What's your budget?", 'whats_your_budget'],
    ['  Café   visit  ', 'cafe_visit'],
    ['2 people', 'q_2_people'],
    ['???', ''],
    ['', ''],
  ])('turns %j into %j', (input, expected) => {
    expect(slugKey(input)).toBe(expected);
  });

  it('keeps keys within the schema limit and valid', () => {
    const key = slugKey('a very long question that keeps going and going and going');
    expect(key.length).toBeLessThanOrEqual(40);
    expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(key.endsWith('_')).toBe(false);
  });
});

describe('uniqueId', () => {
  it('adds a numeric suffix only when needed', () => {
    expect(uniqueId('a', new Set())).toBe('a');
    expect(uniqueId('a', new Set(['a']))).toBe('a_2');
    expect(uniqueId('a', new Set(['a', 'a_2']))).toBe('a_3');
  });
});

describe('newQuestion', () => {
  it('creates valid, non-clashing questions', () => {
    const first = newQuestion('short_text', []);
    const second = newQuestion('short_text', [{ id: first.id, key: first.key }]);
    expect(second.id).not.toBe(first.id);
    expect(second.key).not.toBe(first.key);
  });

  it('starts booking questions in WhatsApp and gives choices two options', () => {
    expect(newQuestion('pick_slot', []).channel).toBe('whatsapp');
    expect(newQuestion('multi_choice', []).channel).toBe('form');
    expect(newQuestion('single_choice', []).options).toHaveLength(2);
    expect(newQuestion('yes_no', []).options).toBeUndefined();
  });

  it('produces a draft that only needs a prompt to validate', () => {
    const draft = emptyDraft();
    const q = newQuestion('single_choice', []);
    draft.questions.push({ ...q, prompt: 'Pick one' });
    expect(validateCampaign(draft).valid).toBe(true);
  });
});

describe('changeType', () => {
  it('moves a question to a channel its new type allows', () => {
    const q = { ...newQuestion('single_choice', []), channel: 'whatsapp' as const };
    expect(changeType(q, 'multi_choice').channel).toBe('form');
    expect(changeType(newQuestion('short_text', []), 'pick_slot').channel).toBe('whatsapp');
  });

  it('adds or drops options to suit the type', () => {
    const text = newQuestion('short_text', []);
    expect(changeType(text, 'single_choice').options).toHaveLength(2);
    const choice = newQuestion('single_choice', []);
    expect(changeType(choice, 'short_text').options).toBeUndefined();
    const edited = { ...choice, options: [{ id: 'x', label: 'X' }] };
    expect(changeType(edited, 'multi_choice').options).toEqual([{ id: 'x', label: 'X' }]);
  });
});

describe('moveItem', () => {
  it('moves within bounds and ignores moves outside them', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 2, 3)).toEqual([1, 2, 3]);
  });

  it('does not mutate its input', () => {
    const items = [1, 2, 3];
    moveItem(items, 0, 2);
    expect(items).toEqual([1, 2, 3]);
  });
});

describe('optionIdFor', () => {
  it('derives ids from labels and keeps them unique', () => {
    expect(optionIdFor('Dental care', new Set())).toBe('dental_care');
    expect(optionIdFor('Dental care', new Set(['dental_care']))).toBe('dental_care_2');
    expect(optionIdFor('???', new Set())).toBe('option');
  });
});

describe('issue grouping', () => {
  const issues = [
    { severity: 'error' as const, path: 'questions.1.prompt', message: 'a' },
    { severity: 'error' as const, path: 'questions.10.prompt', message: 'b' },
    { severity: 'error' as const, path: 'questions', message: 'c' },
    { severity: 'warning' as const, path: 'settings.reminderTemplate', message: 'd' },
  ];

  it('matches an index exactly, not by prefix of the number', () => {
    expect(issuesForQuestion(issues, 1).map((i) => i.message)).toEqual(['a']);
    expect(issuesForQuestion(issues, 10).map((i) => i.message)).toEqual(['b']);
  });

  it('keeps list-level and settings issues for the campaign', () => {
    expect(issuesForCampaign(issues).map((i) => i.message)).toEqual(['c', 'd']);
  });
});
