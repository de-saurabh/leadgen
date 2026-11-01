import {
  roleCan,
  validateCampaign,
  type CampaignConfigInput,
  type QuestionType,
} from '@leadgen/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  campaignQuery,
  issuesFromError,
  numbersQuery,
  useConfig,
  usePublishCampaign,
  useSaveCampaign,
  type Campaign,
  type PublishedSummary,
} from '@/features/campaigns/api';
import {
  BOOKING_QUESTION_TYPES,
  TYPE_LABELS,
  issuesForCampaign,
  issuesForQuestion,
  moveItem,
  newQuestion,
} from '@/features/campaigns/draft';
import { OfferingsCard } from '@/features/booking/OfferingsCard';
import { Preview } from '@/features/campaigns/Preview';
import { QuestionEditor } from '@/features/campaigns/QuestionEditor';
import { SettingsEditor } from '@/features/campaigns/SettingsEditor';
import { ShareDialog } from '@/features/campaigns/ShareDialog';
import { useMe } from '@/features/session/me';

export function CampaignBuilderPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const campaign = useQuery(campaignQuery(id));

  if (me.data && !(me.data.role && roleCan(me.data.role, { campaign: ['read'] }))) {
    return <p className="text-muted-foreground text-sm">Your role can&apos;t open campaigns.</p>;
  }
  if (campaign.isPending) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (campaign.isError) {
    return (
      <p className="text-destructive text-sm">
        Could not open this campaign.{' '}
        <Link to="/campaigns" className="underline">
          Back to campaigns
        </Link>
      </p>
    );
  }
  return (
    <Builder
      key={campaign.data.campaign.id}
      campaign={campaign.data.campaign}
      published={campaign.data.published}
      canEdit={me.data?.role ? roleCan(me.data.role, { campaign: ['update'] }) : false}
      canPublish={me.data?.role ? roleCan(me.data.role, { campaign: ['publish'] }) : false}
      businessName={me.data?.business?.name ?? 'Your business'}
    />
  );
}

function snapshot(name: string, numberId: string | null, draft: CampaignConfigInput) {
  return JSON.stringify({ name, numberId, draft });
}

function Builder({
  campaign,
  published,
  canEdit,
  canPublish,
  businessName,
}: {
  campaign: Campaign;
  published: PublishedSummary | null;
  canEdit: boolean;
  canPublish: boolean;
  businessName: string;
}) {
  const queryClient = useQueryClient();
  const numbers = useQuery(numbersQuery);
  const config = useConfig();
  const save = useSaveCampaign(campaign.id);
  const publish = usePublishCampaign(campaign.id);

  const [name, setName] = useState(campaign.name);
  const [numberId, setNumberId] = useState<string | null>(campaign.whatsappNumberId);
  const [draft, setDraft] = useState<CampaignConfigInput>(campaign.draft);
  const [saved, setSaved] = useState(() =>
    snapshot(campaign.name, campaign.whatsappNumberId, campaign.draft),
  );
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = snapshot(name, numberId, draft) !== saved;
  const validation = useMemo(() => validateCampaign(draft), [draft]);
  const errors = validation.issues.filter((i) => i.severity === 'error');
  const bookingGoal = draft.settings.goal === 'booking';
  const everLive = published !== null;
  const hasUnpublished = everLive && (dirty || !published.matchesDraft);

  async function persist() {
    await save.mutateAsync({
      name,
      draft,
      ...(numberId && { whatsappNumberId: numberId }),
    });
    setSaved(snapshot(name, numberId, draft));
    await queryClient.invalidateQueries({ queryKey: ['campaigns', campaign.id] });
  }

  async function onSave() {
    setNotice(null);
    try {
      await persist();
      setNotice('Saved.');
    } catch {
      /* the mutation's error state is shown below */
    }
  }

  async function onPublish() {
    setNotice(null);
    try {
      if (dirty) await persist();
      const result = await publish.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: ['campaigns', campaign.id] });
      setNotice(`Published as version ${result.version}. New leads use it from now on.`);
    } catch {
      /* shown below */
    }
  }

  function setQuestions(
    update: (qs: CampaignConfigInput['questions']) => CampaignConfigInput['questions'],
  ) {
    setDraft((d) => ({ ...d, questions: update(d.questions) }));
  }

  const failure = publish.error
    ? issuesFromError(publish.error)
    : save.error
      ? issuesFromError(save.error)
      : null;
  const addable = (Object.keys(TYPE_LABELS) as QuestionType[]).filter(
    (t) => bookingGoal || !BOOKING_QUESTION_TYPES.includes(t),
  );
  const slug = campaign.slug;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/campaigns" className="text-muted-foreground text-sm hover:underline">
          ← Campaigns
        </Link>
        <h1 className="text-xl font-semibold">{name || 'Untitled campaign'}</h1>
        {!everLive ? (
          <Badge variant="secondary">Draft</Badge>
        ) : (
          <Badge>Live · v{published.version}</Badge>
        )}
        {hasUnpublished && <Badge variant="outline">Unpublished changes</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {everLive && config.data && (
            <ShareDialog publicUrl={config.data.publicUrl} slug={slug} campaignName={name} />
          )}
          {canEdit && (
            <Button variant="outline" onClick={onSave} disabled={!dirty || save.isPending}>
              {save.isPending && !publish.isPending ? 'Saving…' : 'Save draft'}
            </Button>
          )}
          {canPublish && (
            <Button
              onClick={onPublish}
              disabled={
                errors.length > 0 ||
                !numberId ||
                publish.isPending ||
                save.isPending ||
                (everLive && !hasUnpublished)
              }
              title={
                errors.length > 0
                  ? 'Fix the problems first'
                  : !numberId
                    ? 'Choose a WhatsApp number first'
                    : undefined
              }
            >
              {publish.isPending ? 'Publishing…' : 'Publish'}
            </Button>
          )}
        </div>
      </div>

      {notice && !failure && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </p>
      )}
      {failure && (
        <div role="alert" className="text-destructive rounded-md bg-red-50 px-3 py-2 text-sm">
          <p>{failure.message}</p>
          {failure.issues.length > 0 && (
            <ul className="list-disc pl-5">
              {failure.issues.map((i, n) => (
                <li key={n}>{i.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Questions</CardTitle>
              <CardDescription>
                Pick where each one is asked. The bot skips anything already answered in the form.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {draft.questions.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  No questions yet. The form always asks for name, WhatsApp number and consent.
                </p>
              )}
              {draft.questions.map((q, index) => (
                <QuestionEditor
                  key={q.id}
                  question={q}
                  index={index}
                  count={draft.questions.length}
                  bookingGoal={bookingGoal}
                  issues={issuesForQuestion(validation.issues, index)}
                  onChange={(next) =>
                    setQuestions((qs) => qs.map((item, i) => (i === index ? next : item)))
                  }
                  onMove={(to) => setQuestions((qs) => moveItem(qs, index, to))}
                  onDelete={() => setQuestions((qs) => qs.filter((_, i) => i !== index))}
                />
              ))}
              {canEdit && (
                <Select
                  value=""
                  onValueChange={(type) =>
                    setQuestions((qs) => [...qs, newQuestion(type as QuestionType, qs)])
                  }
                >
                  <SelectTrigger className="w-56" aria-label="Add a question">
                    <Plus className="size-4" />
                    <SelectValue placeholder="Add a question" />
                  </SelectTrigger>
                  <SelectContent>
                    {addable.map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <CampaignIssues issues={issuesForCampaign(validation.issues)} />
            </CardContent>
          </Card>

          {bookingGoal && (
            <OfferingsCard
              campaignId={campaign.id}
              needsResources={draft.questions.some(
                (q) => q.type === 'pick_slot' || q.type === 'pick_resource',
              )}
              needsEvents={draft.questions.some((q) => q.type === 'pick_event')}
              canEdit={canEdit}
            />
          )}

          <SettingsEditor
            name={name}
            onName={setName}
            settings={draft.settings}
            onSettings={(settings) => setDraft((d) => ({ ...d, settings }))}
            numbers={numbers.data ?? []}
            numberId={numberId}
            onNumber={setNumberId}
            config={config.data}
          />
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Preview draft={draft} campaignName={name} businessName={businessName} />
        </aside>
      </div>
    </div>
  );
}

function CampaignIssues({ issues }: { issues: ReturnType<typeof issuesForCampaign> }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Problems with the campaign">
      {issues.map((issue, i) => (
        <li
          key={i}
          className={
            issue.severity === 'error' ? 'text-destructive text-sm' : 'text-sm text-amber-700'
          }
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
