import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Refreshes the dashboard when the server says something changed (server-sent events). */
export function useLiveUpdates(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    // EventSource reconnects by itself after a drop.
    const source = new EventSource('/api/stream');
    source.onmessage = (event) => {
      let type = '';
      try {
        type = (JSON.parse(event.data as string) as { type?: string }).type ?? '';
      } catch {
        return;
      }
      if (type === 'booking') void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      else {
        void queryClient.invalidateQueries({ queryKey: ['leads'] });
        void queryClient.invalidateQueries({ queryKey: ['lead'] });
        void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      }
    };
    return () => source.close();
  }, [enabled, queryClient]);
}
