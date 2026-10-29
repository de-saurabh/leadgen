import { z } from 'zod';
import { WHATSAPP_LIMITS } from '../whatsapp/limits.js';
import { questionSchema } from './questions.js';

export const GOALS = ['lead', 'booking'] as const;
export type Goal = (typeof GOALS)[number];

export const RESOURCE_SELECTIONS = ['customer_picks', 'auto_assign'] as const;

const templateRefSchema = z.object({
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(10),
  /** One placeholder text per template variable, in order: `["{{name}}", "{{booking.time}}"]`. */
  params: z.array(z.string().trim().min(1).max(1024)).max(10).default([]),
});
export type TemplateRef = z.infer<typeof templateRefSchema>;

export const settingsSchema = z.object({
  goal: z.enum(GOALS).default('lead'),
  /** Test mode sends Meta's `hello_world`, which takes no variables. */
  openingTemplate: templateRefSchema.default({
    name: 'hello_world',
    language: 'en_US',
    params: [],
  }),
  reminderTemplate: templateRefSchema.optional(),
  /** Minutes before the booking, one reminder each. */
  reminderOffsets: z.array(z.number().int().min(1).max(10_080)).max(5).default([180]),
  resourceSelection: z.enum(RESOURCE_SELECTIONS).default('customer_picks'),
  countPartySize: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
  handoff: z
    .object({
      label: z.string().trim().min(1).max(WHATSAPP_LIMITS.replyButtons.titleMaxLength),
      ack: z.string().trim().min(1).max(WHATSAPP_LIMITS.textBodyMaxLength),
      keywords: z.array(z.string().trim().toLowerCase().min(1).max(40)).min(1).max(10),
    })
    .default({
      label: 'Talk to a human',
      ack: 'No problem, someone from {{business}} will reply here shortly.',
      keywords: ['human', 'agent'],
    }),
  nudge: z.string().trim().min(1).max(200).default('Please pick one of the options below.'),
  confirmation: z.string().trim().min(1).max(WHATSAPP_LIMITS.textBodyMaxLength),
});
export type CampaignSettings = z.infer<typeof settingsSchema>;

export const campaignConfigSchema = z.object({
  questions: z.array(questionSchema).max(30),
  settings: settingsSchema,
});
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;
/** What an owner (or an example file) writes, before defaults are applied. */
export type CampaignConfigInput = z.input<typeof campaignConfigSchema>;
