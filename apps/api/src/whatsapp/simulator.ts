import { randomBytes, randomUUID } from 'node:crypto';
import type { GraphClient } from './graph.js';

/**
 * Numbers that start with this are made up: they can't be real, so the simulator uses them to
 * play a customer without sending anything to Meta.
 */
export const SIMULATOR_PREFIX = '0000';

export const isSimulatorPhone = (phone: string) => phone.startsWith(SIMULATOR_PREFIX);

/** A fresh made-up customer number. */
export function newSimulatorPhone(): string {
  const digits = BigInt(`0x${randomBytes(5).toString('hex')}`) % 10_000_000_000n;
  return `${SIMULATOR_PREFIX}${digits.toString().padStart(10, '0')}`;
}

/** Sends to real numbers through `inner`; made-up numbers get a fake receipt and no network call. */
export function withSimulator(inner: GraphClient): GraphClient {
  return {
    send(target, to, message) {
      if (isSimulatorPhone(to)) return Promise.resolve({ waMessageId: `sim.${randomUUID()}` });
      return inner.send(target, to, message);
    },
    subscribeApp: (accessToken, wabaId) => inner.subscribeApp(accessToken, wabaId),
  };
}
