import { parseAnswer, type Answers } from '@leadgen/shared';
import express, { Router } from 'express';
import type { AppDb } from '../auth/auth.js';
import { SOURCES, createLead, loadPublishedCampaign, type Source } from '../services/leads.js';
import { normalizePhone } from '../services/phone.js';
import { FIELD, renderForm, renderNotFound, renderThankYou } from '../views/form.js';

type Body = Record<string, string | string[] | undefined>;

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Source and UTM values travel as hidden fields so they survive a failed submit. */
function trackingFrom(input: Body): { source: Source; utm: Record<string, string> } {
  const src = first(input.src);
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = first(input[key]).trim().slice(0, 100);
    if (value) utm[key] = value;
  }
  return { source: SOURCES.find((s) => s === src) ?? 'link', utm };
}

export interface PublicFormDeps {
  db: AppDb;
  /** Called after a lead is saved; failures are the caller's to log. */
  onLeadCreated?: ((leadId: string) => void) | undefined;
}

export function publicFormRouter({ db, onLeadCreated }: PublicFormDeps) {
  const router = Router();

  router.get('/f/:slug', async (req, res) => {
    const campaign = await loadPublishedCampaign(db, String(req.params.slug));
    if (!campaign) {
      res.status(404).type('html').send(renderNotFound());
      return;
    }
    const { source, utm } = trackingFrom(req.query as Body);
    res.type('html').send(
      renderForm({
        businessName: campaign.businessName,
        campaignName: campaign.campaignName,
        questions: campaign.config.questions.filter((q) => q.channel === 'form'),
        hidden: { src: source, ...utm },
      }),
    );
  });

  router.post('/f/:slug', express.urlencoded({ extended: false }), async (req, res) => {
    const campaign = await loadPublishedCampaign(db, String(req.params.slug));
    if (!campaign) {
      res.status(404).type('html').send(renderNotFound());
      return;
    }
    const body = (req.body ?? {}) as Body;
    const { source, utm } = trackingFrom(body);

    // Bots fill every field; a person never sees this one. Pretend it worked.
    if (first(body[FIELD.honeypot]) !== '') {
      res.type('html').send(
        renderThankYou({
          name: first(body.name),
          businessName: campaign.businessName,
          whatsappNumber: campaign.whatsappDisplayNumber ?? '',
        }),
      );
      return;
    }

    const errors: Record<string, string> = {};
    const name = first(body[FIELD.name]).trim();
    if (!name) errors[FIELD.name] = 'Please tell us your name.';
    else if (name.length > 80) errors[FIELD.name] = 'Keep your name under 80 characters.';

    const phone = normalizePhone(first(body[FIELD.phone]), campaign.defaultCountryCode);
    if (!phone) errors[FIELD.phone] = 'Enter a valid WhatsApp number, with country code if abroad.';
    if (first(body[FIELD.consent]) !== 'yes') {
      errors[FIELD.consent] = 'We need your OK to message you on WhatsApp.';
    }

    const formQuestions = campaign.config.questions.filter((q) => q.channel === 'form');
    const answers: Answers = {};
    for (const q of formQuestions) {
      const field = FIELD.question(q.key);
      const raw = body[field];
      const parsed = parseAnswer(q, q.type === 'multi_choice' ? (raw ?? []) : first(raw));
      if (!parsed.ok) errors[field] = parsed.reason;
      else if (parsed.value !== '') answers[q.key] = parsed.value;
    }

    if (Object.keys(errors).length > 0 || !phone) {
      res
        .status(422)
        .type('html')
        .send(
          renderForm({
            businessName: campaign.businessName,
            campaignName: campaign.campaignName,
            questions: formQuestions,
            values: body as Record<string, string | string[]>,
            errors,
            hidden: { src: source, ...utm },
          }),
        );
      return;
    }

    const lead = await createLead(db, { campaign, name, phone, answers, source, utm });
    onLeadCreated?.(lead.id);
    res.type('html').send(
      renderThankYou({
        name,
        businessName: campaign.businessName,
        whatsappNumber: campaign.whatsappDisplayNumber ?? '',
      }),
    );
  });

  return router;
}
