import { optionsOf, type Question } from '@leadgen/shared';
import { esc, page } from './html.js';

export interface FormView {
  businessName: string;
  campaignName: string;
  questions: Question[];
  /** Raw values from a previous attempt, keyed by field name. */
  values?: Record<string, string | string[]>;
  /** Error messages keyed by field name. */
  errors?: Record<string, string>;
  /** Hidden fields carried through the submit (source, utm_*). */
  hidden?: Record<string, string>;
}

export const FIELD = {
  name: 'name',
  phone: 'phone',
  consent: 'consent',
  honeypot: 'website',
  question: (key: string) => `q_${key}`,
} as const;

function valueOf(view: FormView, name: string): string {
  const v = view.values?.[name];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function listOf(view: FormView, name: string): string[] {
  const v = view.values?.[name];
  return Array.isArray(v) ? v : v ? [v] : [];
}

function field(view: FormView, name: string, label: string, control: string, hint?: string) {
  const error = view.errors?.[name];
  return `<div class="field">${control.startsWith('<fieldset') ? control : `<label for="${esc(name)}">${esc(label)}</label>${control}`}${
    hint ? `<p class="hint">${esc(hint)}</p>` : ''
  }${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}</div>`;
}

function group(label: string, inputs: string) {
  return `<fieldset class="field" style="margin:0"><legend>${esc(label)}</legend>${inputs}</fieldset>`;
}

function renderQuestion(view: FormView, q: Question): string {
  const name = FIELD.question(q.key);
  const req = q.required ? ' required' : '';
  const label = q.prompt + (q.required ? '' : ' (optional)');
  const value = valueOf(view, name);
  const attrs = `id="${esc(name)}" name="${esc(name)}"${req}`;

  switch (q.type) {
    case 'long_text':
      return field(
        view,
        name,
        label,
        `<textarea ${attrs} maxlength="2000">${esc(value)}</textarea>`,
      );
    case 'email':
      return field(view, name, label, `<input type="email" ${attrs} value="${esc(value)}">`);
    case 'number':
      return field(
        view,
        name,
        label,
        `<input type="number" step="any" ${attrs} value="${esc(value)}">`,
      );
    case 'party_size':
      return field(
        view,
        name,
        label,
        `<input type="number" min="1" max="100" inputmode="numeric" ${attrs} value="${esc(value)}">`,
      );
    case 'date':
      return field(view, name, label, `<input type="date" ${attrs} value="${esc(value)}">`);
    case 'single_choice':
    case 'yes_no': {
      const options = optionsOf(q);
      const radios = options
        .map(
          (o) =>
            `<label class="choice"><input type="radio" name="${esc(name)}" value="${esc(o.id)}"${
              value === o.id ? ' checked' : ''
            }${req}> ${esc(o.label)}</label>`,
        )
        .join('');
      return field(view, name, label, group(label, radios));
    }
    case 'multi_choice': {
      const picked = new Set(listOf(view, name));
      const boxes = optionsOf(q)
        .map(
          (o) =>
            `<label class="choice"><input type="checkbox" name="${esc(name)}" value="${esc(o.id)}"${
              picked.has(o.id) ? ' checked' : ''
            }> ${esc(o.label)}</label>`,
        )
        .join('');
      return field(view, name, label, group(label, boxes));
    }
    default:
      return field(
        view,
        name,
        label,
        `<input type="text" ${attrs} maxlength="200" value="${esc(value)}">`,
      );
  }
}

export function renderForm(view: FormView): string {
  const hidden = Object.entries(view.hidden ?? {})
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  const hasErrors = Object.keys(view.errors ?? {}).length > 0;
  const consentError = view.errors?.[FIELD.consent];

  return page(
    view.campaignName,
    `<h1>${esc(view.campaignName)}</h1>
${hasErrors ? '<p class="banner" role="alert">Please check the highlighted answers.</p>' : ''}
<form method="post" novalidate>
${field(view, FIELD.name, 'Your name', `<input type="text" id="name" name="name" required maxlength="80" autocomplete="name" value="${esc(valueOf(view, FIELD.name))}">`)}
${field(
  view,
  FIELD.phone,
  'WhatsApp number',
  `<input type="tel" id="phone" name="phone" required autocomplete="tel" inputmode="tel" value="${esc(valueOf(view, FIELD.phone))}">`,
  'We will continue the conversation on WhatsApp.',
)}
${view.questions.map((q) => renderQuestion(view, q)).join('\n')}
<div class="field">
<label class="choice"><input type="checkbox" name="consent" value="yes"${valueOf(view, FIELD.consent) ? ' checked' : ''}> I agree to be contacted on WhatsApp by ${esc(view.businessName)}.</label>
${consentError ? `<p class="error" role="alert">${esc(consentError)}</p>` : ''}
</div>
<div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="${FIELD.honeypot}" tabindex="-1" autocomplete="off"></label></div>
${hidden}
<button type="submit">Continue</button>
</form>`,
  );
}

export function renderThankYou(opts: {
  name: string;
  businessName: string;
  whatsappNumber: string;
}): string {
  const link = `https://wa.me/${encodeURIComponent(opts.whatsappNumber)}?text=${encodeURIComponent('Hi')}`;
  return page(
    'Thank you',
    `<h1>Thanks, ${esc(opts.name)}!</h1>
<p class="muted">${esc(opts.businessName)} will continue on WhatsApp. Tap below to start the chat.</p>
${
  opts.whatsappNumber
    ? `<a class="button" href="${esc(link)}" rel="noopener">Continue on WhatsApp</a>`
    : ''
}`,
  );
}

export function renderNotFound(): string {
  return page(
    'Not found',
    '<h1>This form isn&#39;t available</h1><p class="muted">The link may be old or the form may be closed.</p>',
  );
}
