import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const DATABASE_URL = 'postgres://leadgen:leadgen@localhost:5433/leadgen';
const BETTER_AUTH_SECRET = 'x'.repeat(32);
const base = { DATABASE_URL, BETTER_AUTH_SECRET };

describe('parseEnv', () => {
  it('applies defaults', () => {
    expect(parseEnv(base)).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: 'http://localhost:3000',
      WEB_ORIGIN: 'http://localhost:5173',
    });
  });

  it('coerces PORT', () => {
    expect(parseEnv({ ...base, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a missing or non-postgres DATABASE_URL', () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...base, DATABASE_URL: 'mysql://x@localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a missing or short BETTER_AUTH_SECRET', () => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseEnv({ DATABASE_URL, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('validates the optional platform admin credentials', () => {
    expect(() => parseEnv({ ...base, PLATFORM_ADMIN_EMAIL: 'not-an-email' })).toThrow(
      /PLATFORM_ADMIN_EMAIL/,
    );
    const env = parseEnv({
      ...base,
      PLATFORM_ADMIN_EMAIL: 'a@b.co',
      PLATFORM_ADMIN_PASSWORD: 'longenough',
    });
    expect(env.PLATFORM_ADMIN_EMAIL).toBe('a@b.co');
  });
});
