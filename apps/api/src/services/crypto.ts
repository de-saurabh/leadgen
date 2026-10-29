import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

/** Encrypts secrets (WhatsApp tokens) for storage. Output: `v1.<iv>.<tag>.<ciphertext>`, base64url parts. */
export function createSecretBox(base64Key: string) {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), data]
        .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
        .join('.');
    },
    decrypt(payload: string): string {
      const [version, iv, tag, data] = payload.split('.');
      if (version !== VERSION || !iv || !tag || data === undefined) {
        throw new Error('Unrecognised encrypted value');
      }
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

export type SecretBox = ReturnType<typeof createSecretBox>;
