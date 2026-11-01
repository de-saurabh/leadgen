import { describe, expect, it } from 'vitest';
import { embedSnippet, formUrl, offsetsToText, textToOffsets } from './helpers';

describe('formUrl', () => {
  it('tags each way of sharing and tolerates a trailing slash', () => {
    expect(formUrl('https://x.example/', 'spring', 'qr')).toBe('https://x.example/f/spring?src=qr');
    expect(formUrl('https://x.example', 'spring', 'link')).toBe(
      'https://x.example/f/spring?src=link',
    );
  });
});

describe('embedSnippet', () => {
  it('is an iframe pointing at the tagged embed address', () => {
    const html = embedSnippet(formUrl('https://x.example', 'spring', 'embed'));
    expect(html).toContain('<iframe src="https://x.example/f/spring?src=embed"');
  });
});

describe('reminder times', () => {
  it('converts between hours (shown) and minutes (stored)', () => {
    expect(offsetsToText([180, 1440])).toBe('3, 24');
    expect(offsetsToText(undefined)).toBe('3');
    expect(textToOffsets('24, 3')).toEqual([1440, 180]);
    expect(textToOffsets('1.5')).toEqual([90]);
  });

  it('ignores junk and non-positive values', () => {
    expect(textToOffsets('')).toEqual([]);
    expect(textToOffsets('abc, 0, -2, 2')).toEqual([120]);
  });
});
