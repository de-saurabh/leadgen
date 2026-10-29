import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@leadgen/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    globalSetup: ['./src/test/globalSetup.ts'],
    // Integration tests share one Postgres database.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
