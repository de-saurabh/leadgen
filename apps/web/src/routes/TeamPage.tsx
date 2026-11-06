import { roleCan } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
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
import {
  errorMessage,
  teamQuery,
  useAddMember,
  useChangeRole,
  useRemoveMember,
  type TeamMember,
} from '@/features/ops/api';
import { useMe } from '@/features/session/me';

const ROLE_HELP: Record<TeamMember['role'], string> = {
  owner: 'Full control of the business',
  manager: 'Runs bookings, leads and the inbox, but cannot change setup',
  member: 'Sees only the bookings on their own resources',
};

export function TeamPage() {
  const me = useMe();
  const role = me.data?.role;
  const canSee = role ? roleCan(role, { resource: ['read'] }) : false;
  const canManage = role ? roleCan(role, { member: ['create'] }) : false;
  const team = useQuery({ ...teamQuery, enabled: canSee });

  if (me.data && !canSee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>Your role doesn&apos;t include the team.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Team</CardTitle>
          <CardDescription>
            Who can sign in to this business. Link a person to what they look after under Bookable.
          </CardDescription>
        </div>
        {canManage && <AddMemberDialog />}
      </CardHeader>
      <CardContent>
        {team.isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : team.isError ? (
          <p className="text-destructive text-sm">Could not load the team.</p>
        ) : (
          <ul className="divide-y">
            {team.data.map((m) => (
              <MemberRow
                key={m.memberId}
                member={m}
                canManage={canManage}
                isMe={m.userId === me.data?.user.id}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MemberRow({
  member,
  canManage,
  isMe,
}: {
  member: TeamMember;
  canManage: boolean;
  isMe: boolean;
}) {
  const change = useChangeRole();
  const remove = useRemoveMember();
  const error = change.error ?? remove.error;
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="font-medium">
            {member.name} {isMe && <Badge variant="secondary">You</Badge>}
          </span>
          <span className="text-muted-foreground text-xs">
            {member.email}
            {member.resources.length > 0 && ` · ${member.resources.map((r) => r.name).join(', ')}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <>
              <Select
                value={member.role}
                onValueChange={(role) =>
                  change.mutate({ memberId: member.memberId, role: role as TeamMember['role'] })
                }
              >
                <SelectTrigger className="w-32" aria-label={`Role for ${member.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['owner', 'manager', 'member'] as const).map((r) => (
                    <SelectItem key={r} value={r}>
                      {r[0]!.toUpperCase() + r.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!isMe && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove ${member.name} from the team?`))
                      remove.mutate(member.memberId);
                  }}
                >
                  Remove
                </Button>
              )}
            </>
          ) : (
            <Badge variant="secondary" className="capitalize">
              {member.role}
            </Badge>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage(error)}
        </p>
      )}
    </li>
  );
}

function AddMemberDialog() {
  const add = useAddMember();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<TeamMember['role']>('member');
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email')).trim();
    add.mutate(
      { name: String(data.get('name')).trim(), email, role },
      {
        onSuccess: (result) => setCreated({ email, password: result.generatedPassword ?? '' }),
      },
    );
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setCreated(null);
      add.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>Add someone</Button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Added</DialogTitle>
              <DialogDescription>
                {created.password
                  ? 'Give them these details. The password is shown only once.'
                  : 'They already had an account, so they sign in with their usual password.'}
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted rounded-md p-3 text-sm">
              <div>Email: {created.email}</div>
              {created.password && <div>Password: {created.password}</div>}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Add someone</DialogTitle>
              <DialogDescription>{ROLE_HELP[role]}.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tm-name">Name</Label>
              <Input id="tm-name" name="name" required maxLength={80} autoFocus />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tm-email">Email</Label>
              <Input id="tm-email" name="email" type="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(r) => setRole(r as TeamMember['role'])}>
                <SelectTrigger aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['owner', 'manager', 'member'] as const).map((r) => (
                    <SelectItem key={r} value={r}>
                      {r[0]!.toUpperCase() + r.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {add.isError && (
              <p role="alert" className="text-destructive text-sm">
                {errorMessage(add.error)}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? 'Adding…' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
