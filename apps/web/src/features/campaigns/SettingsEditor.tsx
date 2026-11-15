import type { CampaignConfigInput } from '@leadgen/shared';
import { Link } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { PublicConfig, WhatsAppNumber } from './api';
import { confirmationForGoal } from './draft';
import { offsetsToText, textToOffsets } from './helpers';

type Settings = CampaignConfigInput['settings'];

interface Props {
  name: string;
  onName: (name: string) => void;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  numbers: readonly WhatsAppNumber[];
  numberId: string | null;
  onNumber: (id: string) => void;
  config: PublicConfig | undefined;
}

function Row({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

export function SettingsEditor({
  name,
  onName,
  settings,
  onSettings,
  numbers,
  numberId,
  onNumber,
  config,
}: Props) {
  const set = (patch: Partial<Settings>) => onSettings({ ...settings, ...patch });
  const booking = settings.goal === 'booking';
  const handoff = settings.handoff ?? {
    label: 'Talk to a human',
    ack: 'No problem, someone from {{business}} will reply here shortly.',
    keywords: ['human', 'agent'],
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Row label="Campaign name" htmlFor="c-name">
            <Input id="c-name" value={name} onChange={(e) => onName(e.target.value)} />
          </Row>
          <Row
            label="What should this campaign achieve?"
            hint={
              booking
                ? 'Customers finish by booking a time or an event.'
                : 'Customers finish as a qualified lead.'
            }
          >
            <Select
              value={settings.goal ?? 'lead'}
              onValueChange={(value) => {
                const goal = value as 'lead' | 'booking';
                set({ goal, confirmation: confirmationForGoal(settings.confirmation, goal) });
              }}
            >
              <SelectTrigger aria-label="Goal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lead">Qualify a lead</SelectItem>
                <SelectItem value="booking">Book a time or event</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="WhatsApp number">
            {numbers.length === 0 ? (
              <p className="text-sm">
                No number connected yet.{' '}
                <Link className="underline" to="/settings">
                  Connect one in Settings
                </Link>
                .
              </p>
            ) : (
              <Select value={numberId ?? ''} onValueChange={onNumber}>
                <SelectTrigger aria-label="WhatsApp number">
                  <SelectValue placeholder="Choose a number" />
                </SelectTrigger>
                <SelectContent>
                  {numbers.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      +{n.displayNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Messages</CardTitle>
          <CardDescription>What the bot says besides the questions.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Row
            label="Confirmation"
            htmlFor="c-confirmation"
            hint={
              booking
                ? 'Sent when the booking is made. You can use {{booking.date}}, {{booking.time}} and {{booking.resource}}.'
                : 'Sent when the conversation is finished.'
            }
          >
            <Textarea
              id="c-confirmation"
              rows={3}
              value={settings.confirmation ?? ''}
              onChange={(e) => set({ confirmation: e.target.value })}
            />
          </Row>
          <Row
            label="Reminder to pick an option"
            htmlFor="c-nudge"
            hint="Added above a question when the customer types instead of tapping."
          >
            <Input
              id="c-nudge"
              value={settings.nudge ?? 'Please pick one of the options below.'}
              onChange={(e) => set({ nudge: e.target.value })}
            />
          </Row>
          <Row
            label="“Talk to a human” label"
            htmlFor="c-handoff-label"
            hint="Shown as the last choice where there is room (max 20 characters)."
          >
            <Input
              id="c-handoff-label"
              maxLength={20}
              value={handoff.label}
              onChange={(e) => set({ handoff: { ...handoff, label: e.target.value } })}
            />
          </Row>
          <Row label="Reply when they ask for a person" htmlFor="c-handoff-ack">
            <Textarea
              id="c-handoff-ack"
              rows={2}
              value={handoff.ack}
              onChange={(e) => set({ handoff: { ...handoff, ack: e.target.value } })}
            />
          </Row>
          <Row
            label="Words that also ask for a person"
            htmlFor="c-handoff-keywords"
            hint="Separate with commas."
          >
            <Input
              id="c-handoff-keywords"
              defaultValue={handoff.keywords.join(', ')}
              onBlur={(e) =>
                set({
                  handoff: {
                    ...handoff,
                    keywords: e.target.value
                      .split(',')
                      .map((k) => k.trim())
                      .filter(Boolean),
                  },
                })
              }
            />
          </Row>
        </CardContent>
      </Card>

      {booking && (
        <Card>
          <CardHeader>
            <CardTitle>Bookings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Row label="Who is booked?">
              <Select
                value={settings.resourceSelection ?? 'customer_picks'}
                onValueChange={(v) =>
                  set({ resourceSelection: v as 'customer_picks' | 'auto_assign' })
                }
              >
                <SelectTrigger aria-label="Resource selection">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer_picks">The customer chooses</SelectItem>
                  <SelectItem value="auto_assign">Assigned automatically</SelectItem>
                </SelectContent>
              </Select>
            </Row>
            <div className="flex items-center gap-2">
              <Switch
                id="c-party"
                checked={settings.countPartySize ?? false}
                onCheckedChange={(countPartySize) => set({ countPartySize })}
              />
              <Label htmlFor="c-party">Count the number of people against capacity</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="c-approval"
                checked={settings.requiresApproval ?? false}
                onCheckedChange={(requiresApproval) => set({ requiresApproval })}
              />
              <Label htmlFor="c-approval">A person approves each booking</Label>
            </div>
            <Row
              label="Reminders (hours before)"
              htmlFor="c-reminders"
              hint="Separate with commas, e.g. 24, 3. Leave empty for none."
            >
              <Input
                id="c-reminders"
                defaultValue={offsetsToText(settings.reminderOffsets)}
                onBlur={(e) => set({ reminderOffsets: textToOffsets(e.target.value) })}
              />
            </Row>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Opening message template</CardTitle>
          <CardDescription>
            {config?.templateMode === 'test'
              ? 'Test mode: Meta’s hello_world is sent whatever you enter here.'
              : 'Sent when someone submits the form, before they have messaged you.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Row label="Template name" htmlFor="c-tpl-name">
            <Input
              id="c-tpl-name"
              value={settings.openingTemplate?.name ?? 'hello_world'}
              onChange={(e) =>
                set({
                  openingTemplate: {
                    language: 'en_US',
                    params: [],
                    ...settings.openingTemplate,
                    name: e.target.value,
                  },
                })
              }
            />
          </Row>
          <Row label="Language code" htmlFor="c-tpl-lang">
            <Input
              id="c-tpl-lang"
              value={settings.openingTemplate?.language ?? 'en_US'}
              onChange={(e) =>
                set({
                  openingTemplate: {
                    name: 'hello_world',
                    params: [],
                    ...settings.openingTemplate,
                    language: e.target.value,
                  },
                })
              }
            />
          </Row>
        </CardContent>
      </Card>
    </div>
  );
}
