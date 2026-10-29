import { roleCan, type Permissions } from '@leadgen/shared';
import { Navigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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

export function HomePage() {
  const me = useMe();
  if (!me.data) return null;
  const { user, business, role, isPlatformAdmin } = me.data;

  // The platform admin has no business of their own; their home is the business list.
  if (!business || !role) {
    return isPlatformAdmin ? <Navigate to="/admin" replace /> : <NoBusiness />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome, {user.name}</CardTitle>
        <CardDescription>
          You&apos;re signed in to <strong>{business.name}</strong> as{' '}
          <strong>{business.roleLabel ?? role}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">What you can do here:</p>
        <ul className="flex flex-col gap-2 text-sm">
          {CAPABILITIES.map(({ label, needs }) => {
            const allowed = roleCan(role, needs);
            return (
              <li key={label} className="flex items-center justify-between">
                <span className={allowed ? '' : 'text-muted-foreground'}>{label}</span>
                <Badge variant={allowed ? 'default' : 'secondary'}>
                  {allowed ? 'allowed' : 'not for your role'}
                </Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
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
