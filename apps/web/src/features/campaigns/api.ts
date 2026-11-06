import type { CampaignConfigInput, ValidationIssue } from '@leadgen/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

export interface CampaignSummary {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  publishedVersionId: string | null;
  updatedAt: string;
}

export interface Campaign extends CampaignSummary {
  whatsappNumberId: string | null;
  draft: CampaignConfigInput;
}

export interface PublishedSummary {
  version: number;
  publishedAt: string;
  /** False when the draft has changes that aren't live yet. */
  matchesDraft: boolean;
}

export interface WhatsAppNumber {
  id: string;
  phoneNumberId: string;
  displayNumber: string;
  status: 'active' | 'disabled';
}

export interface PublicConfig {
  publicUrl: string;
  templateMode: 'test' | 'live';
}

export const campaignsQuery = queryOptions({
  queryKey: ['campaigns'],
  queryFn: () => api<{ campaigns: CampaignSummary[] }>('/api/campaigns').then((r) => r.campaigns),
});

export const campaignQuery = (id: string) =>
  queryOptions({
    queryKey: ['campaigns', id],
    queryFn: () =>
      api<{ campaign: Campaign; published: PublishedSummary | null }>(`/api/campaigns/${id}`),
  });

export const numbersQuery = queryOptions({
  queryKey: ['whatsapp-numbers'],
  queryFn: () => api<{ numbers: WhatsAppNumber[] }>('/api/whatsapp-numbers').then((r) => r.numbers),
});

export const configQuery = queryOptions({
  queryKey: ['config'],
  queryFn: () => api<PublicConfig>('/api/config'),
  staleTime: Infinity,
});

export function useConfig() {
  return useQuery(configQuery);
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; draft: CampaignConfigInput; whatsappNumberId?: string }) =>
      api<{ campaign: Campaign }>('/api/campaigns', { json: input }).then((r) => r.campaign),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useSaveCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: {
      name?: string;
      whatsappNumberId?: string;
      draft?: CampaignConfigInput;
    }) => api<{ campaign: Campaign }>(`/api/campaigns/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export interface PublishResult {
  version: number;
  warnings: ValidationIssue[];
}

export function usePublishCampaign(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<PublishResult>(`/api/campaigns/${id}/publish`, { method: 'POST', json: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}

export function useConnectNumber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      phoneNumberId: string;
      displayNumber: string;
      accessToken: string;
      wabaId?: string;
    }) =>
      api<{ number: WhatsAppNumber; warning?: string }>('/api/whatsapp-numbers', { json: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whatsapp-numbers'] }),
  });
}

/** Issues from a failed publish (422), or an empty list for any other error. */
export function issuesFromError(error: unknown): { message: string; issues: ValidationIssue[] } {
  if (error instanceof ApiError && error.body && typeof error.body === 'object') {
    const body = error.body as { message?: string; issues?: ValidationIssue[] };
    return { message: body.message ?? 'Something went wrong.', issues: body.issues ?? [] };
  }
  return { message: 'Something went wrong. Try again.', issues: [] };
}
