import type { CampaignConfigInput } from './config.js';

const reminderText = (extra: string) => ({
  name: 'booking_reminder',
  language: 'en',
  params: ['{{name}}', '{{booking.time}}', extra],
});

/** Clinic: the customer picks a doctor, then a slot. */
export const clinicExample: CampaignConfigInput = {
  questions: [
    {
      id: 'reason',
      key: 'reason',
      type: 'single_choice',
      channel: 'form',
      prompt: 'What do you need help with?',
      options: [
        { id: 'checkup', label: 'General check-up' },
        { id: 'skin', label: 'Skin' },
        { id: 'dental', label: 'Dental' },
        { id: 'child', label: 'Child health' },
        { id: 'other', label: 'Something else' },
      ],
    },
    {
      id: 'first_visit',
      key: 'first_visit',
      type: 'yes_no',
      channel: 'whatsapp',
      prompt: 'Is this your first visit to {{business}}?',
    },
    {
      id: 'doctor',
      key: 'doctor',
      type: 'pick_resource',
      channel: 'whatsapp',
      prompt: 'Who would you like to see for {{answers.reason}}?',
    },
    {
      id: 'slot',
      key: 'slot',
      type: 'pick_slot',
      channel: 'whatsapp',
      prompt: 'When suits you?',
    },
  ],
  settings: {
    goal: 'booking',
    resourceSelection: 'customer_picks',
    reminderTemplate: reminderText('{{booking.resource}}'),
    confirmation:
      "You're booked, {{name}}: {{booking.resource}} on {{booking.date}} at {{booking.time}}. Reply here to cancel or reschedule.",
  },
};

/** Restaurant: tables are assigned automatically and party size counts against capacity. */
export const restaurantExample: CampaignConfigInput = {
  questions: [
    {
      id: 'party',
      key: 'party',
      type: 'party_size',
      channel: 'form',
      prompt: 'How many people?',
    },
    {
      id: 'occasion',
      key: 'occasion',
      type: 'single_choice',
      channel: 'whatsapp',
      prompt: 'Is it a special occasion?',
      required: false,
      options: [
        { id: 'none', label: 'Just dinner' },
        { id: 'birthday', label: 'Birthday' },
        { id: 'anniversary', label: 'Anniversary' },
      ],
    },
    {
      id: 'slot',
      key: 'slot',
      type: 'pick_slot',
      channel: 'whatsapp',
      prompt: 'Table for {{answers.party}}. When would you like to come?',
    },
  ],
  settings: {
    goal: 'booking',
    resourceSelection: 'auto_assign',
    countPartySize: true,
    reminderTemplate: reminderText('{{answers.party}}'),
    confirmation:
      'Table booked, {{name}}! {{booking.date}} at {{booking.time}} for {{answers.party}}. See you at {{business}}.',
  },
};

/** Pub/club: guests book a spot at a one-off event. */
export const pubExample: CampaignConfigInput = {
  questions: [
    {
      id: 'party',
      key: 'party',
      type: 'party_size',
      channel: 'form',
      prompt: 'How many in your group?',
    },
    {
      id: 'event',
      key: 'event',
      type: 'pick_event',
      channel: 'whatsapp',
      prompt: 'Which night are you joining us?',
    },
    {
      id: 'table_pref',
      key: 'table_pref',
      type: 'single_choice',
      channel: 'whatsapp',
      prompt: 'Any seating preference?',
      required: false,
      options: [
        { id: 'floor', label: 'Dance floor' },
        { id: 'lounge', label: 'Lounge' },
        { id: 'any', label: 'No preference' },
      ],
    },
  ],
  settings: {
    goal: 'booking',
    countPartySize: true,
    reminderOffsets: [1440, 180],
    reminderTemplate: reminderText('{{booking.resource}}'),
    confirmation:
      "You're on the list, {{name}}! {{booking.resource}}, {{booking.date}}, doors {{booking.time}}.",
  },
};

/** A plain lead-qualification campaign with no booking. */
export const leadExample: CampaignConfigInput = {
  questions: [
    {
      id: 'budget',
      key: 'budget',
      type: 'single_choice',
      channel: 'whatsapp',
      prompt: "What's your budget, {{name}}?",
      options: [
        { id: 'low', label: 'Under 5 lakh' },
        { id: 'mid', label: '5–15 lakh' },
        { id: 'high', label: 'Over 15 lakh' },
      ],
    },
    {
      id: 'notes',
      key: 'notes',
      type: 'long_text',
      channel: 'form',
      prompt: 'Anything we should know?',
      required: false,
    },
  ],
  settings: {
    goal: 'lead',
    confirmation: 'Thanks {{name}}, someone from {{business}} will be in touch.',
  },
};

export const EXAMPLE_CAMPAIGNS = {
  clinic: clinicExample,
  restaurant: restaurantExample,
  pub: pubExample,
  lead: leadExample,
} as const;
