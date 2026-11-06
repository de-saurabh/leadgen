import { roleCan, type Permissions } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Navigate } from 'react-router';
import { Kpi } from '@/components/Kpi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { analyticsQuery } from '@/features/ops/api';
import { useMe } from '@/features/session/me';

const CAPABILITIES: Array<{ label: string; needs: Permissions }> = [
  { label: 'Build and publish campaigns', needs: { campaign: ['create', 'publish'] } },
  { label: 'Manage resources, hours and events', needs: { resource: ['create'] } },
  { label: 'See all leads', needs: { lead: ['read'] } },
  { label: 'Reply in the shared inbox', needs: { inbox: ['reply'] } },
  { label: 'Manage bookings', needs: { booking: ['update'] } },
  { label: 'See analytics', needs: { analytics: ['read'] } },
  { label: 'Change business settings and team', needs: { settings: ['update'] } },
];

const pct = (n: number, whole: number) => (whole > 0 ? Math.round((n / whole) * 100) : 0);

export function HomePage() {
  const me = useMe();
  const canSeeAnalytics = me.data?.role ? roleCan(me.data.role, { analytics: ['read'] }) : false;
  const stats = useQuery({ ...analyticsQuery({ days: 30 }), enabled: canSeeAnalytics });
  if (!me.data) return null;
  const { user, business, role, isPlatformAdmin } = me.data;

  // The platform admin has no business of their own; their home is the business list.
  if (!business || !role) {
    return isPlatformAdmin ? <Navigate to="/admin" replace /> : <NoBusiness />;
  }

  const totals = stats.data?.totals;

  return (
    <div className="flex flex-col gap-6">
      <div className="rise flex flex-col gap-1">
        <h1 className="text-aurora text-3xl font-bold tracking-tight">Welcome, {user.name}</h1>
        <p className="text-muted-foreground text-sm">
          You&apos;re signed in to <strong>{business.name}</strong> as{' '}
          <strong>{business.roleLabel ?? role}</strong>.
        </p>
      </div>

      {totals && (
        <section aria-label="Last 30 days" className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Last 30 days
          </h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Leads" value={totals.leads} hint="came in" index={1} />
            <Kpi
              label="Replied"
              value={pct(totals.replied, totals.leads)}
              suffix="%"
              hint={`${totals.replied} on WhatsApp`}
              index={2}
            />
            <Kpi label="Booked" value={totals.booked} hint="appointments" index={3} />
            <Kpi
              label="Need a person"
              value={totals.handedOff}
              hint="asked for a human"
              index={4}
            />
          </div>
        </section>
      )}

      <Card className="rise" style={{ '--i': 5 } as CSSProperties}>
        <CardHeader>
          <CardTitle>What you can do here</CardTitle>
          <CardDescription>Based on your role.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {CAPABILITIES.map(({ label, needs }) => {
              const allowed = roleCan(role, needs);
              return (
                <li
                  key={label}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 ${
                    allowed ? 'bg-muted/60' : 'text-muted-foreground'
                  }`}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
                      allowed ? 'bg-aurora text-white' : 'bg-muted'
                    }`}
                  >
                    {allowed ? <Check className="size-3" /> : <Minus className="size-3" />}
                  </span>
                  <span>{label}</span>
                  {!allowed && <span className="ml-auto text-xs">not for your role</span>}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function NoBusiness() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No business yet</CardTitle>
        <CardDescription>
          Your account isn&apos;t linked to a business. Ask your administrator to add you.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
