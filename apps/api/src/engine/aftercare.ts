import {
  WHATSAPP_LIMITS,
  parseReplyId,
  replyId,
  type InboundMessage,
  type OutboundMessage,
} from '@leadgen/shared';

/** Reply ids of the change-your-booking buttons are `_booking:<action>`. */
export const BOOKING_QUESTION_ID = '_booking';

export type AftercareIntent = 'cancel' | 'cancel_yes' | 'keep' | 'reschedule' | 'other';

const ACTIONS: Record<string, AftercareIntent> = {
  cancel: 'cancel',
  cancel_yes: 'cancel_yes',
  keep: 'keep',
  reschedule: 'reschedule',
};

/** What a customer with a booking is asking for. */
export function intentOf(message: InboundMessage): AftercareIntent {
  if (message.kind === 'reply') {
    const parsed = parseReplyId(message.id);
    if (parsed?.questionId === BOOKING_QUESTION_ID) return ACTIONS[parsed.optionId] ?? 'other';
    return 'other';
  }
  if (message.kind !== 'text') return 'other';
  if (
    /re-?schedul|(change|move) (my |the )?(time|date|slot|booking|appointment)|(another|different) (time|day|slot)/i.test(
      message.body,
    )
  ) {
    return 'reschedule';
  }
  if (/\bcancel/i.test(message.body)) return 'cancel';
  return 'other';
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** A message with Reschedule and Cancel buttons under it. */
export function changeButtons(body: string): OutboundMessage {
  return {
    kind: 'buttons',
    body: clip(body, WHATSAPP_LIMITS.interactiveBodyMaxLength),
    options: [
      { id: replyId(BOOKING_QUESTION_ID, 'reschedule'), title: 'Reschedule' },
      { id: replyId(BOOKING_QUESTION_ID, 'cancel'), title: 'Cancel' },
    ],
  };
}

export function cancelConfirmation(body: string): OutboundMessage {
  return {
    kind: 'buttons',
    body: clip(body, WHATSAPP_LIMITS.interactiveBodyMaxLength),
    options: [
      { id: replyId(BOOKING_QUESTION_ID, 'cancel_yes'), title: 'Yes, cancel' },
      { id: replyId(BOOKING_QUESTION_ID, 'keep'), title: 'Keep it' },
    ],
  };
}
