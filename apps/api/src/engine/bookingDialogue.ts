import {
  HANDOFF_MARKER,
  WHATSAPP_LIMITS,
  handoffFits,
  parseReplyId,
  replyId,
  type ChoiceOption,
  type InboundMessage,
  type OutboundMessage,
  type Question,
} from '@leadgen/shared';
import {
  PARTS_OF_DAY,
  formatDay,
  formatTime,
  localParts,
  partOfDay,
  ymdToString,
  type PartOfDay,
} from '../bookings/time.js';
import type { Booked, BookingPort, SlotOffer } from '../services/booking.js';

/** Where the customer is inside a booking question; kept on the lead between messages. */
export interface BookingState {
  /** The chosen resource; null (or unset) means any. */
  resourceId?: string | null;
  day?: string;
  part?: PartOfDay;
  /** How many of the day's times were already paged past. */
  offset?: number;
  /** What the confirmation message fills in once something is booked. */
  booking?: {
    id: string;
    date: string;
    time: string;
    resource: string;
    status: 'pending' | 'confirmed';
  };
}

export interface DialogueDeps {
  port: BookingPort;
  partySize: number;
  /** Renders a question prompt with the lead's placeholders filled in. */
  prompt: (text: string) => string;
  handoffLabel: string;
  nudge: string;
}

export type DialogueResult =
  | { kind: 'message'; message: OutboundMessage }
  /** The question is answered without asking, e.g. the only resource was chosen for them. */
  | { kind: 'skip'; answer: string }
  | { kind: 'booked'; answer: string; booked: Booked }
  /** Nothing is on offer; a person has to take over. */
  | { kind: 'none' };

const MAX_ROWS = WHATSAPP_LIMITS.list.maxRows;
const LIST_BUTTON = 'Choose';

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

function listMessage(
  q: Question,
  body: string,
  rows: ChoiceOption[],
  handoffLabel: string,
): DialogueResult {
  const options = handoffFits(rows.length)
    ? [...rows, { id: replyId(q.id, HANDOFF_MARKER), title: handoffLabel }]
    : rows;
  return {
    kind: 'message',
    message: {
      kind: 'list',
      body: clip(body, WHATSAPP_LIMITS.interactiveBodyMaxLength),
      buttonText: LIST_BUTTON,
      options: options.map((o) => ({
        id: o.id,
        title: clip(o.title, WHATSAPP_LIMITS.list.rowTitleMaxLength),
        description:
          o.description && clip(o.description, WHATSAPP_LIMITS.list.rowDescriptionMaxLength),
      })),
    },
  };
}

/** The optionId of a tap on this question's own message, if that's what the customer sent. */
function tappedOption(q: Question, message: InboundMessage): string | undefined {
  if (message.kind !== 'reply') return undefined;
  const parsed = parseReplyId(message.id);
  return parsed && parsed.questionId === q.id ? parsed.optionId : undefined;
}

const PART_LABELS: Record<PartOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

const dayKey = (slot: SlotOffer, tz: string) => ymdToString(localParts(slot.startsAt, tz).date);

function bookedResult(answer: string, booked: Booked): Extract<DialogueResult, { kind: 'booked' }> {
  return { kind: 'booked', answer, booked };
}

/** Asks (or re-asks) a booking question from the state the customer is in. */
export async function askBooking(
  q: Question,
  state: BookingState,
  deps: DialogueDeps,
  prefix = '',
): Promise<DialogueResult> {
  switch (q.type) {
    case 'pick_resource':
      return askResource(q, state, deps, prefix);
    case 'pick_slot':
      return askSlot(q, state, deps, prefix);
    case 'pick_event':
      return askEvent(q, state, deps, prefix);
    default:
      throw new Error(`${q.type} is not a booking question`);
  }
}

/** Reads the customer's message as an answer to a booking question. */
export async function answerBooking(
  q: Question,
  state: BookingState,
  message: InboundMessage,
  deps: DialogueDeps,
): Promise<DialogueResult> {
  const option = tappedOption(q, message);
  const nudge = `${deps.nudge}\n\n`;
  if (option === undefined) return askBooking(q, state, deps, nudge);

  switch (q.type) {
    case 'pick_resource': {
      if (option === 'any') {
        state.resourceId = null;
        return { kind: 'skip', answer: 'Any available' };
      }
      const resource = (await deps.port.resources()).find((r) => r.id === option);
      if (!resource) return askBooking(q, state, deps, nudge);
      state.resourceId = resource.id;
      return { kind: 'skip', answer: resource.name };
    }

    case 'pick_slot': {
      if (option.startsWith('d')) {
        state.day = option.slice(1);
        delete state.part;
        state.offset = 0;
      } else if (option.startsWith('p_')) {
        state.part = option.slice(2) as PartOfDay;
        state.offset = 0;
      } else if (option === 'more') {
        state.offset = (state.offset ?? 0) + MAX_ROWS - 1;
      } else if (option.startsWith('t')) {
        const startsAt = new Date(Number(option.slice(1)));
        if (Number.isNaN(startsAt.getTime())) return askBooking(q, state, deps, nudge);
        const booked = await deps.port.bookSlot({
          resourceId: state.resourceId ?? null,
          startsAt,
          partySize: deps.partySize,
        });
        if (!booked) {
          return askBooking(
            q,
            state,
            deps,
            'Sorry, that time was just taken. Please pick another.\n\n',
          );
        }
        delete state.day;
        delete state.part;
        delete state.offset;
        return bookedResult(booked.startsAt.toISOString(), booked);
      } else {
        return askBooking(q, state, deps, nudge);
      }
      return askBooking(q, state, deps);
    }

    case 'pick_event': {
      if (!option.startsWith('e')) return askBooking(q, state, deps, nudge);
      const booked = await deps.port.bookEvent({
        eventId: option.slice(1),
        partySize: deps.partySize,
      });
      if (!booked) {
        return askBooking(
          q,
          state,
          deps,
          'Sorry, that one just filled up. Please pick another.\n\n',
        );
      }
      return bookedResult(booked.name, booked);
    }

    default:
      throw new Error(`${q.type} is not a booking question`);
  }
}

async function askResource(
  q: Question,
  state: BookingState,
  deps: DialogueDeps,
  prefix: string,
): Promise<DialogueResult> {
  const resources = await deps.port.resources();
  if (resources.length === 0) return { kind: 'none' };
  if (resources.length === 1) {
    state.resourceId = resources[0]!.id;
    return { kind: 'skip', answer: resources[0]!.name };
  }
  const rows: ChoiceOption[] = [
    { id: replyId(q.id, 'any'), title: 'Any available' },
    ...resources.slice(0, MAX_ROWS - 1).map((r) => ({ id: replyId(q.id, r.id), title: r.name })),
  ];
  return listMessage(q, `${prefix}${deps.prompt(q.prompt)}`, rows, deps.handoffLabel);
}

async function askSlot(
  q: Question,
  state: BookingState,
  deps: DialogueDeps,
  prefix: string,
): Promise<DialogueResult> {
  const { port, partySize } = deps;
  const tz = port.timeZone;
  const slots = await port.slots(state.resourceId ?? null, partySize);
  // "Any available" shows each time once; the resource is picked when it's booked.
  const seen = new Set<number>();
  const unique = slots.filter(
    (s) => !seen.has(s.startsAt.getTime()) && seen.add(s.startsAt.getTime()),
  );
  if (unique.length === 0) return { kind: 'none' };

  const byDay = new Map<string, SlotOffer[]>();
  for (const slot of unique) {
    const key = dayKey(slot, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), slot]);
  }

  if (!state.day || !byDay.has(state.day)) {
    delete state.day;
    delete state.part;
    state.offset = 0;
    const rows = [...byDay.entries()].slice(0, MAX_ROWS).map(([key, daySlots]) => ({
      id: replyId(q.id, `d${key}`),
      title: formatDay(daySlots[0]!.startsAt, tz),
      description: `${daySlots.length} ${daySlots.length === 1 ? 'time' : 'times'} free`,
    }));
    return listMessage(q, `${prefix}${deps.prompt(q.prompt)}`, rows, deps.handoffLabel);
  }

  const daySlots = byDay.get(state.day)!;
  const dayLabel = formatDay(daySlots[0]!.startsAt, tz);

  // Many times in one day: narrow to morning/afternoon/evening first.
  let times = daySlots;
  if (daySlots.length > MAX_ROWS) {
    const parts = PARTS_OF_DAY.filter((p) => daySlots.some((s) => partOfDay(s.startsAt, tz) === p));
    if (!state.part || !parts.includes(state.part)) {
      delete state.part;
      state.offset = 0;
      const rows = parts.map((p) => ({
        id: replyId(q.id, `p_${p}`),
        title: PART_LABELS[p],
        description: `${daySlots.filter((s) => partOfDay(s.startsAt, tz) === p).length} times free`,
      }));
      return listMessage(q, `${prefix}What time of day on ${dayLabel}?`, rows, deps.handoffLabel);
    }
    times = daySlots.filter((s) => partOfDay(s.startsAt, tz) === state.part);
  }

  const offset = Math.min(state.offset ?? 0, Math.max(0, times.length - 1));
  state.offset = offset;
  const rest = times.slice(offset);
  const more = rest.length > MAX_ROWS;
  const shown = more ? rest.slice(0, MAX_ROWS - 1) : rest;
  const rows: ChoiceOption[] = shown.map((s) => ({
    id: replyId(q.id, `t${s.startsAt.getTime()}`),
    title: formatTime(s.startsAt, tz),
  }));
  if (more) rows.push({ id: replyId(q.id, 'more'), title: 'Show later times' });
  return listMessage(q, `${prefix}What time on ${dayLabel}?`, rows, deps.handoffLabel);
}

async function askEvent(
  q: Question,
  state: BookingState,
  deps: DialogueDeps,
  prefix: string,
): Promise<DialogueResult> {
  void state;
  const { port, partySize } = deps;
  const tz = port.timeZone;
  const events = await port.events(partySize);
  if (events.length === 0) return { kind: 'none' };
  if (events.length === 1) {
    const booked = await port.bookEvent({ eventId: events[0]!.id, partySize });
    return booked ? bookedResult(booked.name, booked) : { kind: 'none' };
  }
  const rows = events.slice(0, MAX_ROWS).map((e) => ({
    id: replyId(q.id, `e${e.id}`),
    title: e.name,
    description: `${formatDay(e.startsAt, tz)}, ${formatTime(e.startsAt, tz)}`,
  }));
  return listMessage(q, `${prefix}${deps.prompt(q.prompt)}`, rows, deps.handoffLabel);
}

/** The text fields a confirmation message fills in for a finished booking. */
export function bookingDisplay(booked: Booked, tz: string): NonNullable<BookingState['booking']> {
  return {
    id: booked.id,
    date: formatDay(booked.startsAt, tz),
    time: formatTime(booked.startsAt, tz),
    resource: booked.name,
    status: booked.status,
  };
}
