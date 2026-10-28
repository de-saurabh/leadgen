/**
 * WhatsApp Cloud API limits that the builder, validator and bot engine must all respect.
 * Keep every Meta-imposed number here so there is one place to update.
 */
export const WHATSAPP_LIMITS = {
  replyButtons: {
    maxButtons: 3,
    titleMaxLength: 20,
    idMaxLength: 256,
  },
  list: {
    maxRows: 10,
    buttonTextMaxLength: 20,
    sectionTitleMaxLength: 24,
    rowTitleMaxLength: 24,
    rowDescriptionMaxLength: 72,
    rowIdMaxLength: 200,
  },
  interactiveBodyMaxLength: 1024,
  textBodyMaxLength: 4096,
  /** Free-form messages are only allowed this long after the customer's last message. */
  customerServiceWindowHours: 24,
} as const;

export type InteractiveKind = 'buttons' | 'list';

/**
 * How a fixed set of options is presented in WhatsApp: reply buttons when they fit,
 * a list for up to 10 rows, or `null` when the options can't be shown in one message.
 */
export function interactiveKindFor(optionCount: number): InteractiveKind | null {
  if (optionCount < 1) return null;
  if (optionCount <= WHATSAPP_LIMITS.replyButtons.maxButtons) return 'buttons';
  if (optionCount <= WHATSAPP_LIMITS.list.maxRows) return 'list';
  return null;
}
