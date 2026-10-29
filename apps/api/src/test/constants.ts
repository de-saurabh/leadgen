export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://leadgen:leadgen@localhost:5433/leadgen_test';

export const TEST_ENV = {
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
  BETTER_AUTH_URL: 'http://localhost:3000',
  WEB_ORIGIN: 'http://localhost:5173',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  META_VERIFY_TOKEN: 'test-verify-token',
  META_APP_SECRET: 'test-app-secret',
} as const;

export const ADMIN = { email: 'admin@test.local', password: 'admin-test-password' } as const;
