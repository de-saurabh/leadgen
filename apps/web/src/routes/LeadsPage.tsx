import { roleCan } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { leadsQuery, type LeadStatus } from '@/features/ops/api';
import { STATUS_LABELS, timeAgo } from '@/features/ops/helpers';
import { useMe } from '@/features/session/me';
import { useFreshIds } from '@/lib/fresh';

type Filter = 'all' | LeadStatus;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'needs_human', label: 'Inbox' },
  { value: 'all', label: 'All leads' },
  { value: 'in_conversation', label: 'Chatting' },
  { value: 'completed', label: 'Done' },
  { value: 'dropped', label: 'Went quiet' },
];

export function LeadsPage() {
  const me = useMe();
  const canSee = me.data?.role ? roleCan(me.data.role, { lead: ['read'] }) : false;
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const leads = useQuery({
    ...leadsQuery({ ...(filter !== 'all' && { status: filter }), q: search.trim() }),
    enabled: canSee,
  });
  const waiting = useQuery({ ...leadsQuery({ status: 'needs_human' }), enabled: canSee });

  const fresh = useFreshIds(leads.data?.map((l) => l.id) ?? [], `${filter}|${search.trim()}`);

  if (me.data && !canSee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Leads</CardTitle>
          <CardDescription>Your role doesn&apos;t include leads.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="rise">
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-aurora text-2xl font-bold">Leads &amp; inbox</CardTitle>
          <CardDescription>
            Everyone who filled in a form. Anyone who asked for a person is in the inbox.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              {FILTERS.map((f) => (
                <TabsTrigger key={f.value} value={f.value}>
                  {f.label}
                  {f.value === 'needs_human' && waiting.data && waiting.data.length > 0 && (
                    <Badge variant="destructive" className="ml-1.5">
                      {waiting.data.length}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Input
            className="w-56"
            placeholder="Search name or phone"
            aria-label="Search leads"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {leads.isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : leads.isError ? (
          <p className="text-destructive text-sm">Could not load leads.</p>
        ) : leads.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {filter === 'needs_human' ? 'Nobody is waiting for a reply.' : 'Nothing here yet.'}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.data.map((lead, i) => (
                <TableRow
                  key={lead.id}
                  className={fresh.has(lead.id) ? 'row-flash' : 'rise'}
                  style={{ '--i': Math.min(i, 12) } as CSSProperties}
                >
                  <TableCell>
                    <Link to={`/leads/${lead.id}`} className="font-medium hover:underline">
                      {lead.name}
                    </Link>
                    <div className="text-muted-foreground text-xs">+{lead.phone}</div>
                  </TableCell>
                  <TableCell>{lead.campaignName}</TableCell>
                  <TableCell className="capitalize">{lead.source}</TableCell>
                  <TableCell>
                    <Badge variant={lead.status === 'needs_human' ? 'destructive' : 'secondary'}>
                      {STATUS_LABELS[lead.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {timeAgo(lead.lastInboundAt ?? lead.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
