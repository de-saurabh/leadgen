import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

export const LEAD_STATUSES = [
  'new',
  'in_conversation',
  'completed',
  'needs_human',
  'dropped',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadSummary {
  id: string;
  name: string;
  phone: string;
  status: LeadStatus;
  source: string;
  campaignId: string;
  campaignName: string;
  botPaused: boolean;
  lastInboundAt: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  direction: 'in' | 'out';
  type: string;
  body: Record<string, unknown>;
  sentByUserId: string | null;
  createdAt: string;
}

export interface LeadDetail {
  lead: LeadSummary;
  answers: Array<{ key: string; question: string; type: string; value: unknown }>;
  messages: ChatMessage[];
  bookings: Array<{
    id: string;
    status: string;
    startsAt: string;
    partySize: number;
    what: string;
  }>;
}

export interface TeamMember {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'manager' | 'member';
  resources: Array<{ id: string; name: string }>;
}

export const leadsQuery = (filters: { status?: LeadStatus; q?: string }) =>
  queryOptions({
    queryKey: ['leads', filters.status ?? 'all', filters.q ?? ''],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.q) params.set('q', filters.q);
      const query = params.toString();
      return api<{ leads: LeadSummary[] }>(`/api/leads${query ? `?${query}` : ''}`).then(
        (r) => r.leads,
      );
    },
  });

export const leadQuery = (id: string) =>
  queryOptions({
    queryKey: ['lead', id],
    queryFn: () => api<LeadDetail>(`/api/leads/${id}`),
  });

export const teamQuery = queryOptions({
  queryKey: ['team'],
  queryFn: () => api<{ team: TeamMember[] }>('/api/team').then((r) => r.team),
});

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === 'object') {
    const body = error.body as { message?: string };
    if (body.message) return body.message;
  }
  return 'Something went wrong. Try again.';
}

function useLeadAction<T>(leadId: string, run: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      await queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export const useReply = (leadId: string) =>
  useLeadAction(leadId, (text: string) => api(`/api/leads/${leadId}/reply`, { json: { text } }));
export const useHandBack = (leadId: string) =>
  useLeadAction(leadId, (_: void) => api(`/api/leads/${leadId}/hand-back`, { json: {} }));
export const useCloseLead = (leadId: string) =>
  useLeadAction(leadId, (_: void) => api(`/api/leads/${leadId}/close`, { json: {} }));

export function useAddMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; role: TeamMember['role'] }) =>
      api<{ userId: string; generatedPassword?: string }>('/api/team', { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });
}

export function useChangeRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { memberId: string; role: TeamMember['role'] }) =>
      api(`/api/team/${input.memberId}`, { method: 'PATCH', json: { role: input.role } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => api(`/api/team/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team'] }),
  });
}

export interface FunnelCounts {
  leads: number;
  replied: number;
  completed: number;
  booked: number;
  handedOff: number;
  dropped: number;
}

export interface Analytics {
  timeZone: string;
  totals: FunnelCounts;
  byCampaign: Array<FunnelCounts & { id: string; name: string }>;
  bySource: Array<FunnelCounts & { source: string }>;
  perDay: Array<{ day: string; leads: number }>;
  dropOff?: Array<{ id: string; prompt: string; answered: number }>;
}

export const analyticsQuery = (filters: {
  days: number;
  campaignId?: string;
  includeSimulator?: boolean;
}) =>
  queryOptions({
    queryKey: [
      'analytics',
      filters.days,
      filters.campaignId ?? 'all',
      filters.includeSimulator ?? false,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('from', new Date(Date.now() - filters.days * 86_400_000).toISOString());
      if (filters.campaignId) params.set('campaignId', filters.campaignId);
      if (filters.includeSimulator) params.set('includeSimulator', 'true');
      return api<Analytics>(`/api/analytics?${params.toString()}`);
    },
  });

export function useStartSimulator() {
  return useMutation({
    mutationFn: (input: { campaignId: string; name?: string }) =>
      api<{ leadId: string }>('/api/simulator/start', { json: input }),
  });
}

export function useSimulatorReply(leadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string } | { replyId: string; title: string }) =>
      api(`/api/simulator/${leadId}/reply`, { json: input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['lead', leadId] }),
  });
}
