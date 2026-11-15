import { useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { messageFromError, useSaveEvent, type BizEvent } from './api';
import { isoToLocalInput, localInputToIso } from './helpers';

export function EventDialog({
  event,
  timeZone,
  children,
}: {
  event?: BizEvent;
  timeZone: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {open && <EventForm event={event} timeZone={timeZone} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EventForm({
  event,
  timeZone,
  onDone,
}: {
  event: BizEvent | undefined;
  timeZone: string;
  onDone: () => void;
}) {
  const save = useSaveEvent(event?.id);
  const [name, setName] = useState(event?.name ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [starts, setStarts] = useState(event ? isoToLocalInput(event.startsAt, timeZone) : '');
  const [ends, setEnds] = useState(event ? isoToLocalInput(event.endsAt, timeZone) : '');
  const [capacity, setCapacity] = useState(String(event?.capacity ?? 50));
  const [active, setActive] = useState(event?.active ?? true);

  const startsAt = localInputToIso(starts, timeZone);
  const endsAt = localInputToIso(ends, timeZone);
  const orderOk = !startsAt || !endsAt || endsAt > startsAt;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!startsAt || !endsAt || !orderOk) return;
    save.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        startsAt,
        endsAt,
        capacity: Number(capacity),
        active,
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{event ? `Edit ${event.name}` : 'Add an event'}</DialogTitle>
        <DialogDescription>
          A one-off night guests can book a spot at, like a DJ night or a festival dinner.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ev-name">Name</Label>
        <Input
          id="ev-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          placeholder="Diwali Night"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="ev-desc">Description (optional)</Label>
        <Textarea
          id="ev-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={2}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ev-start">Starts</Label>
          <Input
            id="ev-start"
            type="datetime-local"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ev-end">Ends</Label>
          <Input
            id="ev-end"
            type="datetime-local"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
            required
          />
        </div>
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">Times are in {timeZone}.</p>
      {!orderOk && (
        <p role="alert" className="text-destructive text-sm">
          The event must end after it starts.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="ev-cap">Spots</Label>
        <Input
          id="ev-cap"
          type="number"
          min={1}
          max={10000}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          required
        />
      </div>
      {event && (
        <div className="flex items-center justify-between">
          <Label htmlFor="ev-active">Open for booking</Label>
          <Switch id="ev-active" checked={active} onCheckedChange={setActive} />
        </div>
      )}
      {save.isError && (
        <p role="alert" className="text-destructive text-sm">
          {messageFromError(save.error)}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={save.isPending || !startsAt || !endsAt || !orderOk}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  );
}
