/** What the dashboard is told so it can refresh without polling. */
export type LiveEvent =
  | { type: 'lead'; leadId: string }
  | { type: 'message'; leadId: string }
  | { type: 'booking'; bookingId: string };

type Listener = (event: LiveEvent) => void;

/**
 * In-process fan-out of live events per business. Behind this interface so a shared
 * implementation (Postgres LISTEN/NOTIFY, Redis) can replace it when there are several servers.
 */
export interface EventBus {
  publish(organizationId: string, event: LiveEvent): void;
  subscribe(organizationId: string, listener: Listener): () => void;
}

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<Listener>>();
  return {
    publish(organizationId, event) {
      for (const listener of listeners.get(organizationId) ?? []) {
        try {
          listener(event);
        } catch {
          // A broken connection must not stop the others hearing about it.
        }
      }
    },
    subscribe(organizationId, listener) {
      const set = listeners.get(organizationId) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(organizationId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(organizationId);
      };
    },
  };
}
