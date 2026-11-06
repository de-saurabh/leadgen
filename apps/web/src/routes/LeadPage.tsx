import { roleCan } from '@leadgen/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { formatWhen } from '@/features/booking/helpers';
import {
  errorMessage,
  leadQuery,
  useCloseLead,
  useHandBack,
  useReply,
  type LeadDetail,
} from '@/features/ops/api';
import {
  STATUS_LABELS,
  answerText,
  describeMessage,
  timeAgo,
  windowIsOpen,
} from '@/features/ops/helpers';
import { useMe } from '@/features/session/me';
import { useFreshIds } from '@/lib/fresh';

export function LeadPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const canSee = me.data?.role ? roleCan(me.data.role, { lead: ['read'] }) : false;
  const detail = useQuery({ ...leadQuery(id), enabled: canSee });

  if (me.data && !canSee) {
    return <p className="text-muted-foreground text-sm">Your role can&apos;t open leads.</p>;
  }
  if (detail.isPending) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (detail.isError) {
    return (
      <p className="text-destructive text-sm">
        Could not open this lead.{' '}
        <Link to="/leads" className="underline">
          Back to leads
        </Link>
      </p>
    );
  }
  return (
    <Conversation
      detail={detail.data}
      timeZone={me.data?.business?.timezone ?? 'UTC'}
      canReply={me.data?.role ? roleCan(me.data.role, { inbox: ['reply'] }) : false}
      canClose={me.data?.role ? roleCan(me.data.role, { lead: ['update'] }) : false}
    />
  );
}

function Conversation({
  detail,
  timeZone,
  canReply,
  canClose,
}: {
  detail: LeadDetail;
  timeZone: string;
  canReply: boolean;
  canClose: boolean;
}) {
  const { lead } = detail;
  const reply = useReply(lead.id);
  const handBack = useHandBack(lead.id);
  const close = useCloseLead(lead.id);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const fresh = useFreshIds(
    detail.messages.map((m) => m.id),
    lead.id,
  );
  const open = windowIsOpen(lead.lastInboundAt);
  const done = lead.status === 'completed' || lead.status === 'dropped';
  const error = reply.error ?? handBack.error ?? close.error;

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [detail.messages.length]);

  function send(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    reply.mutate(body, { onSuccess: () => setText('') });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rise flex flex-wrap items-center gap-3">
        <Link to="/leads" className="text-muted-foreground text-sm hover:underline">
          ← Leads
        </Link>
        <h1 className="text-aurora text-2xl font-bold tracking-tight">{lead.name}</h1>
        <Badge variant={lead.status === 'needs_human' ? 'destructive' : 'secondary'}>
          {STATUS_LABELS[lead.status]}
        </Badge>
        <span className="text-muted-foreground text-sm">
          +{lead.phone} · {lead.campaignName} · via {lead.source}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
            <CardDescription>
              {lead.lastInboundAt
                ? `They last wrote ${timeAgo(lead.lastInboundAt)}.`
                : 'They have not replied on WhatsApp yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div
              className="bg-muted/40 flex max-h-[28rem] min-h-48 flex-col gap-2 overflow-y-auto rounded-2xl p-3"
              aria-label="Messages"
            >
              {detail.messages.length === 0 && (
                <p className="text-muted-foreground text-sm">No messages yet.</p>
              )}
              {detail.messages.map((m, i) => (
                <div
                  key={m.id}
                  style={{ '--i': fresh.has(m.id) ? 0 : Math.min(i, 12) } as CSSProperties}
                  className={`pop max-w-[80%] px-3.5 py-2 text-sm whitespace-pre-wrap ${
                    fresh.has(m.id) ? 'flash ' : ''
                  }${
                    m.direction === 'out'
                      ? 'bg-aurora ml-auto rounded-2xl rounded-br-md text-white'
                      : 'glass rounded-2xl rounded-bl-md'
                  }`}
                >
                  {describeMessage(m.type, m.body)}
                  <div className="mt-1 text-[10px] opacity-70">
                    {m.direction === 'out' && (m.sentByUserId ? 'You · ' : 'Bot · ')}
                    {formatWhen(m.createdAt, timeZone)}
                  </div>
                </div>
              ))}
              <div ref={bottom} />
            </div>

            {canReply && !done && (
              <form onSubmit={send} className="flex flex-col gap-2">
                <Textarea
                  aria-label="Your reply"
                  placeholder={open ? 'Write a reply…' : 'More than 24 hours since they wrote'}
                  value={text}
                  disabled={!open}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" disabled={!open || !text.trim() || reply.isPending}>
                    {reply.isPending ? 'Sending…' : 'Send'}
                  </Button>
                  {lead.status === 'needs_human' && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!open || handBack.isPending}
                      onClick={() => handBack.mutate()}
                    >
                      Hand back to the bot
                    </Button>
                  )}
                  {canClose && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={close.isPending}
                      onClick={() => close.mutate()}
                    >
                      Mark as done
                    </Button>
                  )}
                </div>
                {!open && (
                  <p className="text-muted-foreground text-xs">
                    WhatsApp only allows a template message after 24 hours of silence. They need to
                    write first.
                  </p>
                )}
              </form>
            )}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {errorMessage(error)}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Answers</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.answers.length === 0 ? (
                <p className="text-muted-foreground text-sm">No answers yet.</p>
              ) : (
                <dl className="flex flex-col gap-2 text-sm">
                  {detail.answers.map((a) => (
                    <div key={a.key}>
                      <dt className="text-muted-foreground text-xs">{a.question}</dt>
                      <dd>{answerText(a.value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bookings</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.bookings.length === 0 ? (
                <p className="text-muted-foreground text-sm">No bookings.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {detail.bookings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2">
                      <span>
                        {b.what}
                        <span className="text-muted-foreground block text-xs">
                          {formatWhen(b.startsAt, timeZone)}
                          {b.partySize > 1 && ` · party of ${b.partySize}`}
                        </span>
                      </span>
                      <Badge variant="secondary">{b.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
