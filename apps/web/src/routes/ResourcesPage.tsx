import { roleCan } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  eventsQuery,
  messageFromError,
  resourcesQuery,
  useDeleteEvent,
  useDeleteResource,
  type BizEvent,
  type Resource,
} from '@/features/booking/api';
import { EventDialog } from '@/features/booking/EventDialog';
import { formatWhen, summarizeHours } from '@/features/booking/helpers';
import { ResourceDialog } from '@/features/booking/ResourceDialog';
import { useMe } from '@/features/session/me';

export function ResourcesPage() {
  const me = useMe();
  const role = me.data?.role;
  const canSee = role ? roleCan(role, { resource: ['read'] }) : false;
  const canEdit = role ? roleCan(role, { resource: ['update'] }) : false;
  const timeZone = me.data?.business?.timezone ?? 'UTC';
  const resources = useQuery({ ...resourcesQuery, enabled: canSee });
  const events = useQuery({ ...eventsQuery, enabled: canSee });

  if (me.data && !canSee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-aurora text-2xl font-bold">Bookable</CardTitle>
          <CardDescription>
            Your role doesn&apos;t include managing what is bookable.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Tabs defaultValue="resources" className="gap-4">
      <TabsList>
        <TabsTrigger value="resources">People &amp; places</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
      </TabsList>

      <TabsContent value="resources">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>People &amp; places</CardTitle>
              <CardDescription>
                Doctors, stylists, tables, rooms or courts customers can book, each with their own
                hours.
              </CardDescription>
            </div>
            {canEdit && (
              <ResourceDialog timeZone={timeZone}>
                <Button>Add</Button>
              </ResourceDialog>
            )}
          </CardHeader>
          <CardContent>
            {resources.isPending ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : resources.isError ? (
              <p className="text-destructive text-sm">Could not load this.</p>
            ) : resources.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing yet. Add the first person or place customers can book.
              </p>
            ) : (
              <ul className="divide-y">
                {resources.data.map((r) => (
                  <ResourceRow key={r.id} resource={r} timeZone={timeZone} canEdit={canEdit} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="events">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Events</CardTitle>
              <CardDescription>
                One-off nights guests can book a spot at, each with its own number of spots.
              </CardDescription>
            </div>
            {canEdit && (
              <EventDialog timeZone={timeZone}>
                <Button>Add</Button>
              </EventDialog>
            )}
          </CardHeader>
          <CardContent>
            {events.isPending ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : events.isError ? (
              <p className="text-destructive text-sm">Could not load events.</p>
            ) : events.data.length === 0 ? (
              <p className="text-muted-foreground text-sm">No events yet.</p>
            ) : (
              <ul className="divide-y">
                {events.data.map((e) => (
                  <EventRow key={e.id} event={e} timeZone={timeZone} canEdit={canEdit} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function ResourceRow({
  resource,
  timeZone,
  canEdit,
}: {
  resource: Resource;
  timeZone: string;
  canEdit: boolean;
}) {
  const remove = useDeleteResource();
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="font-medium">{resource.name}</span>
          <span className="text-muted-foreground text-xs">
            {summarizeHours(resource.hours)} · {resource.slotMinutes} min slots
            {resource.capacity > 1 && ` · ${resource.capacity} per slot`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!resource.active && <Badge variant="secondary">Off</Badge>}
          {canEdit && (
            <>
              <ResourceDialog resource={resource} timeZone={timeZone}>
                <Button size="sm" variant="outline">
                  Edit
                </Button>
              </ResourceDialog>
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${resource.name}?`)) remove.mutate(resource.id);
                }}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      {remove.isError && (
        <p role="alert" className="text-destructive text-sm">
          {messageFromError(remove.error)}
        </p>
      )}
    </li>
  );
}

function EventRow({
  event,
  timeZone,
  canEdit,
}: {
  event: BizEvent;
  timeZone: string;
  canEdit: boolean;
}) {
  const remove = useDeleteEvent();
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col">
          <span className="font-medium">{event.name}</span>
          <span className="text-muted-foreground text-xs">
            {formatWhen(event.startsAt, timeZone)} · {event.capacity} spots
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!event.active && <Badge variant="secondary">Closed</Badge>}
          {canEdit && (
            <>
              <EventDialog event={event} timeZone={timeZone}>
                <Button size="sm" variant="outline">
                  Edit
                </Button>
              </EventDialog>
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${event.name}?`)) remove.mutate(event.id);
                }}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      {remove.isError && (
        <p role="alert" className="text-destructive text-sm">
          {messageFromError(remove.error)}
        </p>
      )}
    </li>
  );
}
