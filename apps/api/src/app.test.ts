import type { AddressInfo } from 'node:net';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const logger = pino({ level: 'silent' });
let close: (() => void) | undefined;

async function start(pingDb: () => Promise<void>) {
  const server = createApp({ logger, pingDb }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  close = () => server.close();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(() => close?.());

describe('GET /api/health', () => {
  it('reports ok when the database responds', async () => {
    const base = await start(async () => {});
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('returns 503 when the database is unreachable', async () => {
    const base = await start(async () => {
      throw new Error('connection refused');
    });
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'degraded', db: 'down' });
  });
});

describe('unknown API routes', () => {
  it('return a JSON 404', async () => {
    const base = await start(async () => {});
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
