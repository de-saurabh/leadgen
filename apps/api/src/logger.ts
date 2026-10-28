import { pino } from 'pino';
import type { Env } from './env.js';

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>) {
  return pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } },
    }),
  });
}

export type Logger = ReturnType<typeof createLogger>;
