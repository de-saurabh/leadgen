import type { BusinessRole } from '@leadgen/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

export interface Me {
  user: { id: string; name: string; email: string; role: string | null };
  isPlatformAdmin: boolean;
  /** Set while a platform admin is viewing the dashboard as this user. */
  impersonatedBy: string | null;
  business: {
    id: string;
    name: string;
    slug: string;
    timezone: string | null;
    roleLabel: string | null;
  } | null;
  role: BusinessRole | null;
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  // Signed out is a normal state here, not an error.
  queryFn: async (): Promise<Me | null> => {
    try {
      return await api<Me>('/api/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  staleTime: 30_000,
  retry: false,
});

export function useMe() {
  return useQuery(meQuery);
}
