import { EXAMPLE_CAMPAIGNS, roleCan, type CampaignConfigInput } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { campaignsQuery, numbersQuery, useCreateCampaign } from '@/features/campaigns/api';
import { emptyDraft } from '@/features/campaigns/draft';
import { useMe } from '@/features/session/me';

const STARTING_POINTS: Array<{ id: string; label: string; draft: () => CampaignConfigInput }> = [
  { id: 'blank', label: 'Start from scratch', draft: emptyDraft },
  { id: 'lead', label: 'Lead qualification', draft: () => clone(EXAMPLE_CAMPAIGNS.lead) },
  { id: 'clinic', label: 'Clinic appointments', draft: () => clone(EXAMPLE_CAMPAIGNS.clinic) },
  {
    id: 'restaurant',
    label: 'Restaurant table booking',
    draft: () => clone(EXAMPLE_CAMPAIGNS.restaurant),
  },
  { id: 'pub', label: 'Event night at a pub or club', draft: () => clone(EXAMPLE_CAMPAIGNS.pub) },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function CampaignsPage() {
  const me = useMe();
  const allowed = me.data?.role ? roleCan(me.data.role, { campaign: ['read'] }) : false;
  const campaigns = useQuery({ ...campaignsQuery, enabled: allowed });

  if (me.data && !allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-aurora text-2xl font-bold">Campaigns</CardTitle>
          <CardDescription>Your role doesn&apos;t include managing campaigns.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const canCreate = me.data?.role ? roleCan(me.data.role, { campaign: ['create'] }) : false;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-aurora text-2xl font-bold">Campaigns</CardTitle>
          <CardDescription>
            Each campaign is a form plus a WhatsApp conversation. Run as many as you like.
          </CardDescription>
        </div>
        {canCreate && <NewCampaignDialog />}
      </CardHeader>
      <CardContent>
        {campaigns.isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : campaigns.isError ? (
          <p className="text-destructive text-sm">Could not load campaigns.</p>
        ) : campaigns.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No campaigns yet. Create the first one.</p>
        ) : (
          <ul className="divide-y">
            {campaigns.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                <div className="flex flex-col">
                  <Link to={`/campaigns/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <span className="text-muted-foreground text-xs">/f/{c.slug}</span>
                </div>
                <Badge variant={c.status === 'published' ? 'default' : 'secondary'}>
                  {c.status === 'published' ? 'Live' : 'Draft'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function NewCampaignDialog() {
  const navigate = useNavigate();
  const create = useCreateCampaign();
  const numbers = useQuery(numbersQuery);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState('blank');

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    const draft = STARTING_POINTS.find((s) => s.id === start)!.draft();
    // A business with one number almost always means that number: save them a step.
    const only = numbers.data?.length === 1 ? numbers.data[0] : undefined;
    create.mutate(
      { name, draft, ...(only && { whatsappNumberId: only.id }) },
      { onSuccess: (campaign) => navigate(`/campaigns/${campaign.id}`) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New campaign</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>You can change everything afterwards.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-name">Name</Label>
            <Input id="new-name" name="name" required minLength={2} maxLength={80} autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Start with</Label>
            <Select value={start} onValueChange={setStart}>
              <SelectTrigger aria-label="Starting point">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STARTING_POINTS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {create.isError && (
            <p role="alert" className="text-destructive text-sm">
              Could not create the campaign. Try again.
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
