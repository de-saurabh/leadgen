import { roleCan } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { campaignsQuery } from '@/features/campaigns/api';
import { analyticsQuery, type FunnelCounts } from '@/features/ops/api';
import { percent } from '@/features/ops/helpers';
import { useMe } from '@/features/session/me';

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

const ALL = 'all';

const SOURCE_LABELS: Record<string, string> = {
  link: 'Link',
  qr: 'QR code',
  embed: 'Embedded form',
};

export function AnalyticsPage() {
  const me = useMe();
  const allowed = me.data?.role ? roleCan(me.data.role, { analytics: ['read'] }) : false;
  const [days, setDays] = useState(30);
  const [campaignId, setCampaignId] = useState(ALL);
  const campaigns = useQuery({ ...campaignsQuery, enabled: allowed });
  const data = useQuery({
    ...analyticsQuery({ days, campaignId: campaignId === ALL ? undefined : campaignId }),
    enabled: allowed,
  });

  if (me.data && !allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analytics</CardTitle>
          <CardDescription>Your role doesn&apos;t include analytics.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const totals = data.data?.totals;
  const maxDay = Math.max(1, ...(data.data?.perDay.map((d) => d.leads) ?? [1]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <div className="flex gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-40" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.days} value={String(r.days)}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={campaignId} onValueChange={setCampaignId}>
            <SelectTrigger className="w-48" aria-label="Campaign">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All campaigns</SelectItem>
              {campaigns.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {data.isPending ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : data.isError || !totals ? (
        <p className="text-destructive text-sm">Could not load analytics.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Funnel</CardTitle>
              <CardDescription>How far people get, out of everyone who came in.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Bar label="Came in" value={totals.leads} whole={totals.leads} />
              <Bar label="Replied on WhatsApp" value={totals.replied} whole={totals.leads} />
              <Bar label="Finished" value={totals.completed} whole={totals.leads} />
              <Bar label="Booked" value={totals.booked} whole={totals.leads} />
              <Bar label="Asked for a person" value={totals.handedOff} whole={totals.leads} />
              <Bar label="Went quiet" value={totals.dropped} whole={totals.leads} />
            </CardContent>
          </Card>

          {data.data.dropOff && (
            <Card>
              <CardHeader>
                <CardTitle>Where people stop</CardTitle>
                <CardDescription>How many answered each WhatsApp question.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {data.data.dropOff.map((q) => (
                  <Bar key={q.id} label={q.prompt} value={q.answered} whole={totals.leads} />
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Leads per day</CardTitle>
            </CardHeader>
            <CardContent>
              {data.data.perDay.length === 0 ? (
                <p className="text-muted-foreground text-sm">No leads in this period.</p>
              ) : (
                <div className="flex h-32 items-end gap-1" role="img" aria-label="Leads per day">
                  {data.data.perDay.map((d) => (
                    <div
                      key={d.day}
                      title={`${d.day}: ${d.leads}`}
                      className="bg-primary min-w-1 flex-1 rounded-t"
                      style={{ height: `${(d.leads / maxDay) * 100}%` }}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Breakdown
              title="By campaign"
              rows={data.data.byCampaign.map((c) => ({ key: c.id, name: c.name, counts: c }))}
            />
            <Breakdown
              title="By source"
              rows={data.data.bySource.map((s) => ({
                key: s.source,
                name: SOURCE_LABELS[s.source] ?? s.source,
                counts: s,
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Bar({ label, value, whole }: { label: string; value: number; whole: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {value} · {percent(value, whole)}
        </span>
      </div>
      <div className="bg-muted h-2 rounded">
        <div
          className="bg-primary h-2 rounded"
          style={{ width: whole > 0 ? `${Math.min(100, (value / whole) * 100)}%` : '0%' }}
        />
      </div>
    </div>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; name: string; counts: FunnelCounts }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 font-normal"></th>
                <th className="py-1 font-normal">Leads</th>
                <th className="py-1 font-normal">Finished</th>
                <th className="py-1 font-normal">Booked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="py-1.5">{r.name}</td>
                  <td>{r.counts.leads}</td>
                  <td>{percent(r.counts.completed, r.counts.leads)}</td>
                  <td>{percent(r.counts.booked, r.counts.leads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
