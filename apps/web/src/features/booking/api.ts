import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { HoursRow } from './helpers';

export const RESOURCE_KINDS = ['person', 'table', 'room', 'court', 'other'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface TimeOff {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface Resource {
  id: string;
  name: string;
  kind: ResourceKind;
  capacity: number;
  slotMinutes: number;
  active: boolean;
  memberUserId: string | null;
  hours: HoursRow[];
  timeOff: TimeOff[];
}

export interface ResourceInput {
  name: string;
  kind: ResourceKind;
  capacity: number;
  slotMinutes: number;
  active?: boolean;
  hours?: HoursRow[];
  memberUserId?: string | null;
}

export interface BizEvent {
  id: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  active: boolean;
}

export interface EventInput {
  name: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  active?: boolean;
}

export const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'rejected',
  'no_show',
  'completed',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface BookingRow {
  id: string;
  status: BookingStatus;
  startsAt: string;
  endsAt: string;
  partySize: number;
  what: string;
  lead: { name: string; phone: string };
}

export interface Offerings {
  resourceIds: string[];
  eventIds: string[];
}

export const resourcesQuery = queryOptions({
  queryKey: ['resources'],
  queryFn: () => api<{ resources: Resource[] }>('/api/resources').then((r) => r.resources),
});

export const eventsQuery = queryOptions({
  queryKey: ['events'],
  queryFn: () => api<{ events: BizEvent[] }>('/api/events').then((r) => r.events),
});

export const bookingsQuery = (status?: BookingStatus) =>
  queryOptions({
    queryKey: ['bookings', status ?? 'all'],
    queryFn: () =>
      api<{ bookings: BookingRow[] }>(`/api/bookings${status ? `?status=${status}` : ''}`).then(
        (r) => r.bookings,
      ),
  });

export const offeringsQuery = (campaignId: string) =>
  queryOptions({
    queryKey: ['offerings', campaignId],
    queryFn: () => api<Offerings>(`/api/campaigns/${campaignId}/offerings`),
  });

/** The message the server sent for a refused change, or a fallback. */
export function messageFromError(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === 'object') {
    const body = error.body as { message?: string };
    if (body.message) return body.message;
  }
  return 'Something went wrong. Try again.';
}

export function useSaveResource(id?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ResourceInput>) =>
      id
        ? api(`/api/resources/${id}`, { method: 'PATCH', json: input })
        : api('/api/resources', { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resources'] }),
  });
}

export function useDeleteResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/resources/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resources'] }),
  });
}

export function useAddTimeOff(resourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { startsAt: string; endsAt: string; reason?: string }) =>
      api(`/api/resources/${resourceId}/time-off`, { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resources'] }),
  });
}

export function useRemoveTimeOff(resourceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (timeOffId: string) =>
      api(`/api/resources/${resourceId}/time-off/${timeOffId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resources'] }),
  });
}

export function useSaveEvent(id?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<EventInput>) =>
      id
        ? api(`/api/events/${id}`, { method: 'PATCH', json: input })
        : api('/api/events', { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/events/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
  });
}

export function useSaveOfferings(campaignId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Offerings) =>
      api<Offerings>(`/api/campaigns/${campaignId}/offerings`, { method: 'PUT', json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['offerings', campaignId] }),
  });
}

export function useChangeBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; status: BookingStatus }) =>
      api<{ notified: boolean }>(`/api/bookings/${input.id}`, {
        method: 'PATCH',
        json: { status: input.status },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
  });
}
