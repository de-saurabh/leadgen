import {
  optionsOf,
  type CampaignConfig,
  type CampaignConfigInput,
  type OutboundMessage,
  type Question,
} from '@leadgen/shared';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { buildWhatsAppPreview, previewConfig, type PreviewStep } from './previewModel';

export function Preview({
  draft,
  campaignName,
  businessName,
}: {
  draft: CampaignConfigInput;
  campaignName: string;
  businessName: string;
}) {
  const config = previewConfig(draft);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">Live preview</h2>
      {!config ? (
        <p className="text-muted-foreground text-sm">
          Fix the highlighted problems to see the preview.
        </p>
      ) : (
        <Tabs defaultValue="form">
          <TabsList>
            <TabsTrigger value="form">Form</TabsTrigger>
            <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
          </TabsList>
          <TabsContent value="form">
            <FormPreview config={config} campaignName={campaignName} businessName={businessName} />
          </TabsContent>
          <TabsContent value="whatsapp">
            <WhatsAppPreview config={config} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function FormPreview({
  config,
  campaignName,
  businessName,
}: {
  config: CampaignConfig;
  campaignName: string;
  businessName: string;
}) {
  const questions = config.questions.filter((q) => q.channel === 'form');
  return (
    <div className="bg-card flex flex-col gap-4 rounded-xl border p-4" aria-label="Form preview">
      <h3 className="text-lg font-semibold">{campaignName || 'Untitled campaign'}</h3>
      <FakeField label="Your name" />
      <FakeField label="WhatsApp number" hint="We will continue the conversation on WhatsApp." />
      {questions.map((q) => (
        <FormQuestion key={q.id} q={q} />
      ))}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" disabled className="mt-1" />I agree to be contacted on WhatsApp by{' '}
        {businessName}.
      </label>
      <div className="bg-primary text-primary-foreground rounded-md py-2 text-center text-sm font-medium">
        Continue
      </div>
    </div>
  );
}

function FakeField({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="bg-background h-9 rounded-md border" />
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

function FormQuestion({ q }: { q: Question }) {
  const label = q.prompt + (q.required ? '' : ' (optional)');
  if (q.type === 'single_choice' || q.type === 'yes_no' || q.type === 'multi_choice') {
    return (
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">{label}</legend>
        {optionsOf(q).map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input type={q.type === 'multi_choice' ? 'checkbox' : 'radio'} disabled /> {o.label}
          </label>
        ))}
      </fieldset>
    );
  }
  return <FakeField label={label} />;
}

function Bubble({ from, children }: { from: 'bot' | 'customer'; children: React.ReactNode }) {
  return (
    <div className={from === 'customer' ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          from === 'customer'
            ? 'max-w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-sm text-neutral-900 shadow-sm'
            : 'max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm'
        }
      >
        {children}
      </div>
    </div>
  );
}

function BotMessage({ message }: { message: OutboundMessage }) {
  return (
    <div className="flex max-w-[85%] flex-col gap-1">
      <Bubble from="bot">
        <span className="whitespace-pre-wrap">{message.body}</span>
      </Bubble>
      {message.kind === 'buttons' &&
        message.options.map((o) => (
          <div
            key={o.id}
            className="rounded-lg bg-white py-2 text-center text-sm font-medium text-sky-700 shadow-sm"
          >
            {o.title}
          </div>
        ))}
      {message.kind === 'list' && (
        <details className="rounded-lg bg-white text-sm shadow-sm">
          <summary className="cursor-pointer py-2 text-center font-medium text-sky-700">
            ☰ {message.buttonText}
          </summary>
          <ul className="divide-y px-3 pb-1 text-neutral-900">
            {message.options.map((o) => (
              <li key={o.id} className="py-2">
                {o.title}
                {o.description && (
                  <span className="block text-xs text-neutral-500">{o.description}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function WhatsAppPreview({ config }: { config: CampaignConfig }) {
  const steps = buildWhatsAppPreview(config);
  return (
    <div
      className="flex flex-col gap-2 rounded-xl bg-[#efeae2] p-3 text-neutral-900"
      aria-label="WhatsApp preview"
    >
      {steps.map((step, i) => (
        <Step key={i} step={step} />
      ))}
      <p className="text-center text-xs text-neutral-500">
        Sample customer. Answers from the form are skipped.
      </p>
    </div>
  );
}

function Step({ step }: { step: PreviewStep }) {
  if (step.from === 'customer') return <Bubble from="customer">{step.text}</Bubble>;
  if (step.from === 'note') {
    return (
      <p className="rounded-md bg-amber-100 px-3 py-1 text-center text-xs text-amber-900">
        {step.text}
      </p>
    );
  }
  return <BotMessage message={step.message} />;
}
