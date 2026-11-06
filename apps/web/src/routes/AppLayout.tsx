import { roleCan } from '@leadgen/shared';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLiveUpdates } from '@/features/ops/live';
import { useMe } from '@/features/session/me';
import { authClient } from '@/lib/auth-client';

/** Everything behind login: redirects anonymous visitors and renders the shared chrome. */
export function AppLayout() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  useLiveUpdates(!!me.data?.business);

  if (me.isPending) return <p className="text-muted-foreground p-6 text-sm">Loadingâ€¦</p>;
  if (!me.data) return <Navigate to="/login" replace />;
  const { user, business, role, isPlatformAdmin, impersonatedBy } = me.data;

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  async function stopImpersonating() {
    await authClient.admin.stopImpersonating();
    await queryClient.invalidateQueries();
    navigate('/', { replace: true });
  }

  return (
    <div className="min-h-svh">
      {impersonatedBy && (
        <div className="flex items-center justify-center gap-3 bg-amber-100 px-4 py-2 text-sm text-amber-950">
          <span>
            Viewing as <strong>{user.name}</strong> (read-only, logged)
          </span>
          <Button size="sm" variant="outline" onClick={stopImpersonating}>
            Exit
          </Button>
        </div>
      )}
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <span className="font-semibold tracking-tight">LeadGen</span>
          {business && (
            <span className="text-muted-foreground flex items-center gap-2 text-sm whitespace-nowrap">
              {business.name}
              {role && <Badge variant="secondary">{business.roleLabel ?? role}</Badge>}
            </span>
          )}
          <nav className="ml-4 flex gap-4 text-sm whitespace-nowrap">
            {business && <NavItem to="/">Home</NavItem>}
            {role && roleCan(role, { campaign: ['read'] }) && (
              <NavItem to="/campaigns" end={false}>
                Campaigns
              </NavItem>
            )}
            {role && roleCan(role, { lead: ['read'] }) && (
              <NavItem to="/leads" end={false}>
                Leads
              </NavItem>
            )}
            {role && roleCan(role, { analytics: ['read'] }) && (
              <NavItem to="/analytics">Analytics</NavItem>
            )}
            {role && roleCan(role, { booking: ['read'] }) && (
              <NavItem to="/bookings">Bookings</NavItem>
            )}
            {role && roleCan(role, { resource: ['read'] }) && (
              <NavItem to="/bookable">Bookable</NavItem>
            )}
            {role && roleCan(role, { resource: ['read'] }) && <NavItem to="/team">Team</NavItem>}
            {role && roleCan(role, { campaign: ['update'] }) && (
              <NavItem to="/simulator">Try it</NavItem>
            )}
            {role && roleCan(role, { whatsappNumber: ['read'] }) && (
              <NavItem to="/settings">Settings</NavItem>
            )}
            {isPlatformAdmin && <NavItem to="/admin">Businesses</NavItem>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground hidden sm:inline">{user.email}</span>
            <ThemeToggle />
            <Button size="sm" variant="outline" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, end = true, children }: { to: string; end?: boolean; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        isActive ? 'font-medium' : 'text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </NavLink>
  );
}
