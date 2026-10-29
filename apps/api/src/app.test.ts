import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './test/helpers.js';

let ctx: TestContext;
afterEach(() => ctx?.close());

describe('GET /api/health', () => {
  it('reports ok when the database responds', async () => {
    ctx = await createTestContext();
    const res = await ctx.client().request('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('returns 503 when the database is unreachable', async () => {
    ctx = await createTestContext({
      pingDb: async () => {
        throw new Error('connection refused');
      },
    });
    const res = await ctx.client().request('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: 'down' });
  });
});

describe('unknown API routes', () => {
  it('return a JSON 404', async () => {
    ctx = await createTestContext();
    const res = await ctx.client().request('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not_found' });
  });
});
