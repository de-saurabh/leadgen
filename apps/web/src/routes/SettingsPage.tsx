import { roleCan } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { numbersQuery, useConnectNumber } from '@/features/campaigns/api';
import { useMe } from '@/features/session/me';
import { ApiError } from '@/lib/api';

export function SettingsPage() {
  const me = useMe();
  const role = me.data?.role;
  const canSee = role ? roleCan(role, { whatsappNumber: ['read'] }) : false;
  const canConnect = role ? roleCan(role, { settings: ['update'] }) : false;
  const numbers = useQuery({ ...numbersQuery, enabled: canSee });

  if (me.data && !canSee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Your role doesn&apos;t include business settings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp number</CardTitle>
        <CardDescription>
          The number your customers chat with. Each business connects its own.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {numbers.isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : numbers.data?.length ? (
          <ul className="divide-y">
            {numbers.data.map((n) => (
              <li key={n.id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium">+{n.displayNumber}</span>
                <Badge variant={n.status === 'active' ? 'default' : 'secondary'}>{n.status}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No number connected yet.</p>
        )}
        {canConnect && <ConnectForm />}
      </CardContent>
    </Card>
  );
}

function ConnectForm() {
  const connect = useConnectNumber();
  const [done, setDone] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setDone(false);
    connect.mutate(
      {
        phoneNumberId: String(data.get('phoneNumberId')).trim(),
        displayNumber: String(data.get('displayNumber')).trim(),
        accessToken: String(data.get('accessToken')).trim(),
      },
      {
        onSuccess: () => {
          form.reset();
          setDone(true);
        },
      },
    );
  }

  const error =
    connect.error instanceof ApiError
      ? connect.error.status === 409
        ? 'That number is already connected.'
        : connect.error.status === 503
          ? 'The server isn’t set up to store tokens yet (TOKEN_ENCRYPTION_KEY).'
          : 'Check the details and try again.'
      : connect.error
        ? 'Something went wrong. Try again.'
        : null;

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4 border-t pt-6">
      <h3 className="text-sm font-medium">Connect a number</h3>
      <div className="flex flex-col gap-2">
        <Label htmlFor="phoneNumberId">Phone number ID</Label>
        <Input
          id="phoneNumberId"
          name="phoneNumberId"
          inputMode="numeric"
          autoComplete="off"
          required
        />
        <p className="text-muted-foreground text-xs">From Meta’s WhatsApp dashboard.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="displayNumber">The number customers see</Label>
        <Input
          id="displayNumber"
          name="displayNumber"
          type="tel"
          autoComplete="off"
          required
          placeholder="+91 98765 43210"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="accessToken">Access token</Label>
        {/* A token for another service, not a sign-in: keep browsers from filling saved logins. */}
        <Input
          id="accessToken"
          name="accessToken"
          type="password"
          autoComplete="new-password"
          required
          minLength={20}
        />
        <p className="text-muted-foreground text-xs">Stored encrypted. You won’t see it again.</p>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-emerald-700">
          Number connected.
        </p>
      )}
      <Button type="submit" className="self-start" disabled={connect.isPending}>
        {connect.isPending ? 'Connecting…' : 'Connect number'}
      </Button>
    </form>
  );
}
