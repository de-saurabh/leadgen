import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  eventsQuery,
  messageFromError,
  offeringsQuery,
  resourcesQuery,
  useSaveOfferings,
  type Offerings,
} from './api';
import { toggled } from './selection';

/** Which people/places and events a booking campaign offers. Saved on its own, not versioned. */
export function OfferingsCard({
  campaignId,
  needsResources,
  needsEvents,
  canEdit,
}: {
  campaignId: string;
  needsResources: boolean;
  needsEvents: boolean;
  canEdit: boolean;
}) {
  const offerings = useQuery(offeringsQuery(campaignId));
  const resources = useQuery({ ...resourcesQuery, enabled: needsResources });
  const events = useQuery({ ...eventsQuery, enabled: needsEvents });

  return (
    <Card>
      <CardHeader>
        <CardTitle>What customers can book</CardTitle>
        <CardDescription>
          Pick what this campaign offers. Changes apply straight away, no need to publish.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {offerings.isPending ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : offerings.isError ? (
          <p className="text-destructive text-sm">Could not load this.</p>
        ) : (
          <OfferingsForm
            key={JSON.stringify(offerings.data)}
            campaignId={campaignId}
            saved={offerings.data}
            resources={needsResources ? (resources.data ?? []) : null}
            events={needsEvents ? (events.data ?? []) : null}
            canEdit={canEdit}
          />
        )}
      </CardContent>
    </Card>
  );
}

function OfferingsForm({
  campaignId,
  saved,
  resources,
  events,
  canEdit,
}: {
  campaignId: string;
  saved: Offerings;
  resources: Array<{ id: string; name: string; active: boolean }> | null;
  events: Array<{ id: string; name: string; active: boolean }> | null;
  canEdit: boolean;
}) {
  const save = useSaveOfferings(campaignId);
  const [resourceIds, setResourceIds] = useState(saved.resourceIds);
  const [eventIds, setEventIds] = useState(saved.eventIds);
  const dirty =
    JSON.stringify([...resourceIds].sort()) !== JSON.stringify([...saved.resourceIds].sort()) ||
    JSON.stringify([...eventIds].sort()) !== JSON.stringify([...saved.eventIds].sort());

  function group(
    title: string,
    items: Array<{ id: string; name: string; active: boolean }>,
    picked: string[],
    setPicked: (ids: string[]) => void,
    emptyHint: string,
  ) {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{title}</legend>
        {items.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {emptyHint}{' '}
            <Link to="/bookable" className="underline">
              Add some
            </Link>
          </p>
        )}
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <Checkbox
              id={`offer-${item.id}`}
              checked={picked.includes(item.id)}
              disabled={!canEdit}
              onCheckedChange={(on) => setPicked(toggled(picked, item.id, on === true))}
            />
            <Label htmlFor={`offer-${item.id}`} className="font-normal">
              {item.name}
              {!item.active && <span className="text-muted-foreground"> (off)</span>}
            </Label>
          </div>
        ))}
      </fieldset>
    );
  }

  return (
    <>
      {resources &&
        group('People & places', resources, resourceIds, setResourceIds, 'Nothing to book yet.')}
      {events && group('Events', events, eventIds, setEventIds, 'No events yet.')}
      {save.isError && (
        <p role="alert" className="text-destructive text-sm">
          {messageFromError(save.error)}
        </p>
      )}
      {canEdit && (
        <div>
          <Button
            variant="outline"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ resourceIds, eventIds })}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </>
  );
}
