import { roleCan } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { campaignsQuery } from '@/features/campaigns/api';
import {
  errorMessage,
  leadQuery,
  useSimulatorReply,
  useStartSimulator,
  type ChatMessage,
} from '@/features/ops/api';
import { describeMessage } from '@/features/ops/helpers';
import { useMe } from '@/features/session/me';

interface Choice {
  id: string;
  title: string;
}

/** The buttons or list rows on a message, so they can be tapped. */
function choicesOf(message: ChatMessage | undefined): Choice[] {
  if (!message || message.direction !== 'out') return [];
  if (message.type !== 'buttons' && message.type !== 'list') return [];
  const options = message.body.options;
  return Array.isArray(options) ? (options as Choice[]) : [];
}

export function SimulatorPage() {
  const me = useMe();
  const allowed = me.data?.role ? roleCan(me.data.role, { campaign: ['update'] }) : false;
  const campaigns = useQuery({ ...campaignsQuery, enabled: allowed });
  const published = campaigns.data?.filter((c) => c.status === 'published') ?? [];
  const [campaignId, setCampaignId] = useState('');
  const [leadId, setLeadId] = useState('');
  const start = useStartSimulator();

  if (me.data && !allowed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-aurora text-2xl font-bold">Try it</CardTitle>
          <CardDescription>Your role doesn&apos;t include the simulator.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  function begin() {
    start.mutate(
      { campaignId: campaignId || published[0]?.id || '' },
      { onSuccess: (r) => setLeadId(r.leadId) },
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-aurora text-2xl font-bold">Try it</CardTitle>
          <CardDescription>
            Play a customer against a published campaign. It runs the real bot, but nothing is sent
            to WhatsApp, and the test lead shows up under Leads.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {published.length === 0 ? (
            <p className="text-muted-foreground text-sm">Publish a campaign first.</p>
          ) : (
            <>
              <Select value={campaignId || published[0]!.id} onValueChange={setCampaignId}>
                <SelectTrigger className="w-60" aria-label="Campaign">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {published.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={begin} disabled={start.isPending}>
                {leadId ? 'Start over' : 'Start'}
              </Button>
            </>
          )}
          {start.isError && (
            <p role="alert" className="text-destructive w-full text-sm">
              {errorMessage(start.error)}
            </p>
          )}
        </CardContent>
      </Card>
      {leadId && <Chat key={leadId} leadId={leadId} />}
    </div>
  );
}

function Chat({ leadId }: { leadId: string }) {
  const lead = useQuery(leadQuery(leadId));
  const reply = useSimulatorReply(leadId);
  const end = useRef<HTMLDivElement>(null);
  const messages = lead.data?.messages ?? [];
  const choices = choicesOf(messages.at(-1));

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length]);

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get('text') ?? '').trim();
    if (!text) return;
    reply.mutate({ text }, { onSuccess: () => form.reset() });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>{lead.data ? lead.data.lead.name : 'Chat'}</span>
          <Link to={`/leads/${leadId}`} className="text-muted-foreground text-sm underline">
            Open as a lead
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="bg-muted/40 flex h-96 flex-col gap-2 overflow-y-auto rounded-2xl p-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`pop max-w-[80%] px-3.5 py-2 text-sm whitespace-pre-wrap ${
                m.direction === 'out'
                  ? 'glass self-start rounded-2xl rounded-bl-md'
                  : 'bg-aurora self-end rounded-2xl rounded-br-md text-white'
              }`}
            >
              {describeMessage(m.type, m.body)}
            </div>
          ))}
          <div ref={end} />
        </div>
        {choices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant="outline"
                disabled={reply.isPending}
                onClick={() => reply.mutate({ replyId: c.id, title: c.title })}
              >
                {c.title}
              </Button>
            ))}
          </div>
        )}
        <form onSubmit={send} className="flex gap-2">
          <Input name="text" placeholder="Type a message" aria-label="Message" autoComplete="off" />
          <Button type="submit" disabled={reply.isPending}>
            Send
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={reply.isPending}
            onClick={() => reply.mutate({ text: 'Hi' })}
          >
            Say hi
          </Button>
        </form>
        {reply.isError && (
          <p role="alert" className="text-destructive text-sm">
            {errorMessage(reply.error)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
