import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretBox } from './crypto.js';

const key = () => randomBytes(32).toString('base64');

describe('secret box', () => {
  it('round-trips, including unicode and empty strings', () => {
    const box = createSecretBox(key());
    for (const text of ['EAAG-token-123', '', 'नमस्ते 🙂']) {
      expect(box.decrypt(box.encrypt(text))).toBe(text);
    }
  });

  it('never repeats a ciphertext and never contains the plaintext', () => {
    const box = createSecretBox(key());
    const a = box.encrypt('secret-token');
    expect(a).not.toBe(box.encrypt('secret-token'));
    expect(a).not.toContain('secret-token');
  });

  it('rejects tampering and the wrong key', () => {
    const box = createSecretBox(key());
    const sealed = box.encrypt('secret-token');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('forged').toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
    expect(() => createSecretBox(key()).decrypt(sealed)).toThrow();
    expect(() => box.decrypt('garbage')).toThrow('Unrecognised');
  });

  it('requires a 32-byte key', () => {
    expect(() => createSecretBox(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');
  });
});
