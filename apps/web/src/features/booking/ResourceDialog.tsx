import { Trash2 } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useQuery } from '@tanstack/react-query';
import { teamQuery } from '@/features/ops/api';
import {
  RESOURCE_KINDS,
  messageFromError,
  useAddTimeOff,
  useRemoveTimeOff,
  useSaveResource,
  type Resource,
  type ResourceKind,
} from './api';
import {
  WEEKDAYS,
  defaultHours,
  formatWhen,
  hoursProblem,
  localInputToIso,
  minutesToTime,
  timeToMinutes,
  type HoursRow,
} from './helpers';

const KIND_LABELS: Record<ResourceKind, string> = {
  person: 'Person (doctor, stylist, trainer)',
  table: 'Table',
  room: 'Room',
  court: 'Court or pitch',
  other: 'Something else',
};

export function ResourceDialog({
  resource,
  timeZone,
  children,
}: {
  resource?: Resource;
  timeZone: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        {/* Mounted only while open, so every opening starts from the saved values. */}
        {open && (
          <ResourceForm resource={resource} timeZone={timeZone} onDone={() => setOpen(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResourceForm({
  resource,
  timeZone,
  onDone,
}: {
  resource: Resource | undefined;
  timeZone: string;
  onDone: () => void;
}) {
  const save = useSaveResource(resource?.id);
  const [name, setName] = useState(resource?.name ?? '');
  const [kind, setKind] = useState<ResourceKind>(resource?.kind ?? 'person');
  const [capacity, setCapacity] = useState(String(resource?.capacity ?? 1));
  const [slotMinutes, setSlotMinutes] = useState(String(resource?.slotMinutes ?? 30));
  const [active, setActive] = useState(resource?.active ?? true);
  const [hours, setHours] = useState<HoursRow[]>(resource?.hours ?? defaultHours());
  const [staff, setStaff] = useState<string>(resource?.memberUserId ?? 'none');
  const team = useQuery(teamQuery);

  const problem = hoursProblem(hours);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (problem) return;
    save.mutate(
      {
        name: name.trim(),
        kind,
        capacity: Number(capacity),
        slotMinutes: Number(slotMinutes),
        active,
        hours,
        memberUserId: staff === 'none' ? null : staff,
      },
      { onSuccess: onDone },
    );
  }

  function setRow(index: number, patch: Partial<HoursRow>) {
    setHours((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{resource ? `Edit ${resource.name}` : 'Add something to book'}</DialogTitle>
        <DialogDescription>
          A person, table, room or court. Each has its own opening hours.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-2">
        <Label htmlFor="res-name">Name</Label>
        <Input
          id="res-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          placeholder="Dr. Rao, Table 4, Court 1…"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Kind</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as ResourceKind)}>
          <SelectTrigger aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESOURCE_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {kind === 'person' && team.data && (
        <div className="flex flex-col gap-2">
          <Label>Linked staff member</Label>
          <Select value={staff} onValueChange={setStaff}>
            <SelectTrigger aria-label="Linked staff member">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nobody (not a team member)</SelectItem>
              {team.data.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            They will see this person&apos;s bookings when signed in as a member.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="res-slot">Slot length (minutes)</Label>
          <Input
            id="res-slot"
            type="number"
            min={5}
            max={480}
            step={5}
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="res-capacity">People per slot</Label>
          <Input
            id="res-capacity"
            type="number"
            min={1}
            max={500}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            required
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Opening hours</legend>
        {hours.length === 0 && (
          <p className="text-muted-foreground text-sm">Closed all week. Add hours to open it.</p>
        )}
        {hours.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <Select
              value={String(row.weekday)}
              onValueChange={(v) => setRow(index, { weekday: Number(v) })}
            >
              <SelectTrigger className="w-36" aria-label="Day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="time"
              aria-label="Opens"
              value={minutesToTime(row.startMinute)}
              onChange={(e) => {
                const m = timeToMinutes(e.target.value);
                if (m !== undefined) setRow(index, { startMinute: m });
              }}
            />
            <span className="text-muted-foreground text-sm">to</span>
            <Input
              type="time"
              aria-label="Closes"
              value={minutesToTime(row.endMinute)}
              onChange={(e) => {
                const m = timeToMinutes(e.target.value);
                if (m !== undefined) setRow(index, { endMinute: m });
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove these hours"
              onClick={() => setHours((rows) => rows.filter((_, i) => i !== index))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setHours((rows) => [...rows, { weekday: 1, startMinute: 9 * 60, endMinute: 17 * 60 }])
            }
          >
            Add hours
          </Button>
        </div>
        {problem && (
          <p role="alert" className="text-destructive text-sm">
            {problem}
          </p>
        )}
      </fieldset>

      {resource && (
        <div className="flex items-center justify-between">
          <Label htmlFor="res-active">Available for booking</Label>
          <Switch id="res-active" checked={active} onCheckedChange={setActive} />
        </div>
      )}

      {resource && <TimeOffSection resource={resource} timeZone={timeZone} />}

      {save.isError && (
        <p role="alert" className="text-destructive text-sm">
          {messageFromError(save.error)}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={save.isPending || !!problem}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TimeOffSection({ resource, timeZone }: { resource: Resource; timeZone: string }) {
  const add = useAddTimeOff(resource.id);
  const remove = useRemoveTimeOff(resource.id);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');

  const startsAt = localInputToIso(from, timeZone);
  const endsAt = localInputToIso(to, timeZone);
  const valid = !!startsAt && !!endsAt && endsAt > startsAt;

  function onAdd() {
    if (!startsAt || !endsAt || !valid) return;
    add.mutate(
      { startsAt, endsAt, ...(reason.trim() && { reason: reason.trim() }) },
      {
        onSuccess: () => {
          setFrom('');
          setTo('');
          setReason('');
        },
      },
    );
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Time off</legend>
      {resource.timeOff.length === 0 && (
        <p className="text-muted-foreground text-sm">No time off planned.</p>
      )}
      <ul className="divide-y text-sm">
        {resource.timeOff.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
            <span>
              {formatWhen(t.startsAt, timeZone)} to {formatWhen(t.endsAt, timeZone)}
              {t.reason && <span className="text-muted-foreground"> · {t.reason}</span>}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove time off"
              disabled={remove.isPending}
              onClick={() => remove.mutate(t.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="datetime-local"
          aria-label="Time off starts"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          type="datetime-local"
          aria-label="Time off ends"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="Reason"
          placeholder="Reason (optional)"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="button" variant="outline" disabled={!valid || add.isPending} onClick={onAdd}>
          Add
        </Button>
      </div>
      {add.isError && (
        <p role="alert" className="text-destructive text-sm">
          {messageFromError(add.error)}
        </p>
      )}
      <p className="text-muted-foreground text-xs">Times are in {timeZone}.</p>
    </fieldset>
  );
}
