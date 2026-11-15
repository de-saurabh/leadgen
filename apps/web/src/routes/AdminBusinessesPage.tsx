import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useMe } from '@/features/session/me';
import { api, ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

interface BusinessSummary {
  id: string;
  name: string;
  slug: string;
  timezone: string | null;
  memberCount: number;
  createdAt: string;
}

interface CreatedBusiness {
  business: { name: string; generatedOwnerPassword?: string };
}

interface CreateInput {
  name: string;
  timezone: string;
  owner: { name: string; email: string; password?: string };
}

export function AdminBusinessesPage() {
  const me = useMe();
  const businesses = useQuery({
    queryKey: ['admin', 'businesses'],
    queryFn: () => api<{ businesses: BusinessSummary[] }>('/api/admin/businesses'),
    enabled: me.data?.isPlatformAdmin === true,
  });

  if (me.data && !me.data.isPlatformAdmin) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-aurora text-2xl font-bold">Businesses</CardTitle>
            <CardDescription>Every business on the platform.</CardDescription>
          </div>
          <NewBusinessDialog />
        </CardHeader>
        <CardContent>
          {businesses.isPending ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : businesses.isError ? (
            <p className="text-destructive text-sm">Could not load businesses.</p>
          ) : businesses.data.businesses.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No businesses yet. Create the first one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Timezone</TableHead>
                  <TableHead className="text-right">People</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {businesses.data.businesses.map((business) => (
                  <TableRow key={business.id}>
                    <TableCell className="font-medium">{business.name}</TableCell>
                    <TableCell className="text-muted-foreground">{business.slug}</TableCell>
                    <TableCell>{business.timezone ?? '—'}</TableCell>
                    <TableCell className="text-right">{business.memberCount}</TableCell>
                    <TableCell>{new Date(business.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <ViewAsDialog business={business} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <AuditCard enabled={me.data?.isPlatformAdmin === true} />
    </div>
  );
}

interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
}

function ViewAsDialog({ business }: { business: BusinessSummary }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const members = useQuery({
    queryKey: ['admin', 'members', business.id],
    queryFn: () => api<{ members: Member[] }>(`/api/admin/businesses/${business.id}/members`),
    enabled: open,
  });

  const start = useMutation({
    mutationFn: async (userId: string) => {
      const res = await authClient.admin.impersonateUser({ userId });
      if (res.error) throw new Error(res.error.message);
    },
    onSuccess: async () => {
      queryClient.clear();
      navigate('/', { replace: true });
    },
    onError: () => setFailed(true),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          View as…
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>View {business.name} as…</DialogTitle>
          <DialogDescription>
            Read-only for 30 minutes. Every view is written to the audit log.
          </DialogDescription>
        </DialogHeader>
        {members.isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : members.isError ? (
          <p className="text-destructive text-sm">Could not load people.</p>
        ) : members.data.members.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nobody in this business yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {members.data.members.map((m) => (
              <li key={m.userId} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {m.email} · {m.role}
                  </span>
                </span>
                <Button size="sm" disabled={start.isPending} onClick={() => start.mutate(m.userId)}>
                  View
                </Button>
              </li>
            ))}
          </ul>
        )}
        {failed && (
          <p role="alert" className="text-destructive text-sm">
            Could not start viewing. Try again.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface AuditEntry {
  id: string;
  action: 'impersonation_started' | 'impersonation_stopped' | 'write_blocked';
  actorName: string | null;
  targetName: string | null;
  businessName: string | null;
  at: string;
}

const AUDIT_LABELS: Record<AuditEntry['action'], string> = {
  impersonation_started: 'started viewing as',
  impersonation_stopped: 'stopped viewing as',
  write_blocked: 'tried to change something while viewing as',
};

function AuditCard({ enabled }: { enabled: boolean }) {
  const audit = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api<{ entries: AuditEntry[] }>('/api/admin/audit'),
    enabled,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Every time an admin views a business as someone.</CardDescription>
      </CardHeader>
      <CardContent>
        {audit.isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : audit.isError ? (
          <p className="text-destructive text-sm">Could not load the log.</p>
        ) : audit.data.entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {audit.data.entries.map((e) => (
              <li key={e.id} className="flex justify-between gap-4 py-2">
                <span>
                  {e.actorName ?? 'Someone'} {AUDIT_LABELS[e.action]} {e.targetName ?? 'a user'}
                  {e.businessName && ` (${e.businessName})`}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {new Date(e.at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function NewBusinessDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ name: string; email: string; password?: string } | null>(
    null,
  );

  const create = useMutation({
    mutationFn: (input: CreateInput) =>
      api<CreatedBusiness>('/api/admin/businesses', { json: input }),
    onSuccess: ({ business }, input) => {
      setCreated({
        name: business.name,
        email: input.owner.email,
        ...(business.generatedOwnerPassword && { password: business.generatedOwnerPassword }),
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'businesses'] });
    },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setCreated(null);
      create.reset();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('ownerPassword') ?? '');
    create.mutate({
      name: String(form.get('name')),
      timezone: String(form.get('timezone')),
      owner: {
        name: String(form.get('ownerName')),
        email: String(form.get('ownerEmail')),
        ...(password && { password }),
      },
    });
  }

  const error =
    create.error instanceof ApiError
      ? create.error.status === 409
        ? 'A business with that name already exists.'
        : 'Check the details and try again.'
      : create.error
        ? 'Something went wrong. Try again.'
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>New business</Button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{created.name} is ready</DialogTitle>
              <DialogDescription>
                {created.password
                  ? 'Share these sign-in details with the owner. The password is shown only once.'
                  : 'The owner already had an account and can sign in as usual.'}
              </DialogDescription>
            </DialogHeader>
            <dl className="bg-muted flex flex-col gap-1 rounded-md p-3 text-sm">
              <div>
                <dt className="text-muted-foreground inline">Email: </dt>
                <dd className="inline font-medium">{created.email}</dd>
              </div>
              {created.password && (
                <div>
                  <dt className="text-muted-foreground inline">Password: </dt>
                  <dd className="inline font-mono font-medium">{created.password}</dd>
                </div>
              )}
            </dl>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>New business</DialogTitle>
              <DialogDescription>Creates the business and its owner account.</DialogDescription>
            </DialogHeader>
            <Field label="Business name" name="name" required />
            <Field label="Timezone" name="timezone" defaultValue="Asia/Kolkata" required />
            <Field label="Owner name" name="ownerName" required />
            {/* These describe a new account, not a sign-in: keep browsers from autofilling saved logins. */}
            <Field label="Owner email" name="ownerEmail" type="email" autoComplete="off" required />
            <Field
              label="Owner password"
              name="ownerPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              hint="Leave blank to generate one."
            />
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create business'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  hint,
  ...props
}: { label: string; name: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}
