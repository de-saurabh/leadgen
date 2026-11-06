import { roleCan } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  bookingsQuery,
  messageFromError,
  useChangeBooking,
  type BookingRow,
  type BookingStatus,
} from '@/features/booking/api';
import { formatWhen } from '@/features/booking/helpers';
import { actionsFor } from '@/features/booking/actions';
import { useMe } from '@/features/session/me';

const FILTERS: Array<{ value: BookingStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'To approve' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'To approve',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  rejected: 'Declined',
  no_show: 'No-show',
  completed: 'Done',
};

export function BookingsPage() {
  const me = useMe();
  const role = me.data?.role;
  const canSee = role ? roleCan(role, { booking: ['read'] }) : false;
  const canEdit = role ? roleCan(role, { booking: ['update'] }) : false;
  const timeZone = me.data?.business?.timezone ?? 'UTC';
  const [filter, setFilter] = useState<BookingStatus | 'all'>('all');
  const bookings = useQuery({
    ...bookingsQuery(filter === 'all' ? undefined : filter),
    enabled: canSee,
  });

  if (me.data && !canSee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-aurora text-2xl font-bold">Bookings</CardTitle>
          <CardDescription>Your role doesn&apos;t include bookings.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-aurora text-2xl font-bold">Bookings</CardTitle>
          <CardDescription>What customers booked through WhatsApp.</CardDescription>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as BookingStatus | 'all')}>
          <TabsList>
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {bookings.isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : bookings.isError ? (
          <p className="text-destructive text-sm">Could not load bookings.</p>
        ) : bookings.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing here yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.data.map((b) => (
                <BookingLine key={b.id} booking={b} timeZone={timeZone} canEdit={canEdit} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function BookingLine({
  booking,
  timeZone,
  canEdit,
}: {
  booking: BookingRow;
  timeZone: string;
  canEdit: boolean;
}) {
  const change = useChangeBooking();
  const [note, setNote] = useState<string | null>(null);

  function run(status: BookingStatus) {
    setNote(null);
    change.mutate(
      { id: booking.id, status },
      {
        onSuccess: (result) => {
          if (!result.notified && ['confirmed', 'rejected', 'cancelled'].includes(status)) {
            setNote('Saved, but the customer could not be messaged on WhatsApp.');
          }
        },
      },
    );
  }

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{formatWhen(booking.startsAt, timeZone)}</TableCell>
      <TableCell>
        {booking.what}
        {booking.partySize > 1 && (
          <span className="text-muted-foreground"> · party of {booking.partySize}</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span>{booking.lead.name}</span>
          <span className="text-muted-foreground text-xs">+{booking.lead.phone}</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={booking.status === 'pending' ? 'default' : 'secondary'}>
          {STATUS_LABELS[booking.status]}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            {canEdit &&
              actionsFor(booking.status).map((a) => (
                <Button
                  key={a.status}
                  size="sm"
                  variant={a.primary ? 'default' : 'outline'}
                  disabled={change.isPending}
                  onClick={() => run(a.status)}
                >
                  {a.label}
                </Button>
              ))}
          </div>
          {change.isError && (
            <span role="alert" className="text-destructive text-xs">
              {messageFromError(change.error)}
            </span>
          )}
          {note && <span className="text-xs text-amber-700">{note}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}
