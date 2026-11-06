import { roleCan } from '@leadgen/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Building2,
  CalendarCheck,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Package,
  Settings,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLiveUpdates } from '@/features/ops/live';
import { useMe } from '@/features/session/me';
import { authClient } from '@/lib/auth-client';

type NavEntry = { to: string; label: string; icon: LucideIcon; end?: boolean };

/** Everything behind login: redirects anonymous visitors and renders the shared chrome. */
export function AppLayout() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useLiveUpdates(!!me.data?.business);

  if (me.isPending) return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
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

  const can = (needs: Parameters<typeof roleCan>[1]) => !!role && roleCan(role, needs);
  const nav: NavEntry[] = [
    ...(business ? [{ to: '/', label: 'Home', icon: LayoutDashboard, end: true }] : []),
    ...(can({ campaign: ['read'] })
      ? [{ to: '/campaigns', label: 'Campaigns', icon: Megaphone }]
      : []),
    ...(can({ lead: ['read'] }) ? [{ to: '/leads', label: 'Leads', icon: Users }] : []),
    ...(can({ analytics: ['read'] })
      ? [{ to: '/analytics', label: 'Analytics', icon: BarChart3 }]
      : []),
    ...(can({ booking: ['read'] })
      ? [{ to: '/bookings', label: 'Bookings', icon: CalendarCheck }]
      : []),
    ...(can({ resource: ['read'] })
      ? [
          { to: '/bookable', label: 'Bookable', icon: Package },
          { to: '/team', label: 'Team', icon: UsersRound },
        ]
      : []),
    ...(can({ campaign: ['update'] })
      ? [{ to: '/simulator', label: 'Try it', icon: FlaskConical }]
      : []),
    ...(can({ whatsappNumber: ['read'] })
      ? [{ to: '/settings', label: 'Settings', icon: Settings }]
      : []),
    ...(isPlatformAdmin ? [{ to: '/admin', label: 'Businesses', icon: Building2 }] : []),
  ];

  return (
    <div className="min-h-svh lg:flex">
      <aside className="glass rise z-10 flex flex-col gap-4 p-4 lg:sticky lg:top-0 lg:h-svh lg:w-64 lg:shrink-0 lg:rounded-none lg:border-y-0 lg:border-l-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span className="bg-aurora flex size-9 items-center justify-center rounded-xl text-sm font-bold text-white shadow-[0_6px_16px_var(--glow)]">
              L
            </span>
            <span className="text-lg font-bold tracking-tight">LeadGen</span>
          </div>
          <div className="flex items-center gap-1 lg:hidden">
            <ThemeToggle />
            <Button size="icon" variant="ghost" onClick={signOut} aria-label="Sign out">
              <LogOut />
            </Button>
          </div>
        </div>

        {business && (
          <div className="bg-muted/60 flex flex-col gap-1 rounded-2xl px-3 py-2.5">
            <span className="truncate text-sm font-semibold">{business.name}</span>
            {role && (
              <Badge variant="secondary" className="w-fit">
                {business.roleLabel ?? role}
              </Badge>
            )}
          </div>
        )}

        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {nav.map((item, i) => (
            <NavItem key={item.to} item={item} index={i} />
          ))}
        </nav>

        <div className="hidden flex-col gap-3 lg:flex">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground truncate text-xs" title={user.email}>
              {user.email}
            </span>
            <ThemeToggle />
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut /> Sign out
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
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
        <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
          <div key={pathname.split('/')[1] ?? ''} className="rise">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ item, index }: { item: NavEntry; index: number }) {
  const { to, label, icon: Icon, end = false } = item;
  return (
    <NavLink
      to={to}
      end={end}
      style={{ '--i': index } as React.CSSProperties}
      className={({ isActive }) =>
        `rise flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-all ${
          isActive
            ? 'bg-card text-sidebar-accent-foreground shadow-[0_6px_18px_var(--glow)]'
            : 'text-sidebar-foreground hover:bg-muted/70 hover:text-foreground'
        }`
      }
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </NavLink>
  );
}
