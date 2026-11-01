import {
  CHANNEL_SUPPORT,
  QUESTION_TYPES,
  type Channel,
  type QuestionType,
  type ValidationIssue,
} from '@leadgen/shared';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  BOOKING_QUESTION_TYPES,
  CHOICE_QUESTION_TYPES,
  TYPE_LABELS,
  changeType,
  optionIdFor,
  slugKey,
  type DraftQuestion,
} from './draft';

const CHANNEL_LABELS: Record<Channel, string> = { form: 'In the form', whatsapp: 'In WhatsApp' };

interface Props {
  question: DraftQuestion;
  index: number;
  count: number;
  /** Booking questions are offered only to campaigns that take bookings. */
  bookingGoal: boolean;
  issues: readonly ValidationIssue[];
  onChange: (question: DraftQuestion) => void;
  onMove: (to: number) => void;
  onDelete: () => void;
}

export function QuestionEditor({
  question,
  index,
  count,
  bookingGoal,
  issues,
  onChange,
  onMove,
  onDelete,
}: Props) {
  const id = `q${index}`;
  const isChoice = CHOICE_QUESTION_TYPES.includes(question.type);
  const isBooking = BOOKING_QUESTION_TYPES.includes(question.type);
  const allowedChannels = CHANNEL_SUPPORT[question.type];
  const types = QUESTION_TYPES.filter(
    (t) => bookingGoal || !BOOKING_QUESTION_TYPES.includes(t) || t === question.type,
  );
  const options = question.options ?? [];

  /** The answer key follows the prompt until the owner edits it by hand. */
  function setPrompt(prompt: string) {
    const followsPrompt = question.key === slugKey(question.prompt) || question.key === '';
    onChange({ ...question, prompt, ...(followsPrompt && { key: slugKey(prompt) }) });
  }

  function setOptionLabel(at: number, label: string) {
    const taken = new Set(options.filter((_, i) => i !== at).map((o) => o.id));
    onChange({
      ...question,
      options: options.map((o, i) =>
        i === at ? { ...o, label, id: optionIdFor(label, taken) } : o,
      ),
    });
  }

  function addOption() {
    const taken = new Set(options.map((o) => o.id));
    const label = `Option ${options.length + 1}`;
    onChange({ ...question, options: [...options, { id: optionIdFor(label, taken), label }] });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground w-6 text-sm tabular-nums">{index + 1}.</span>
          <Select
            value={question.type}
            onValueChange={(t) => onChange(changeType(question, t as QuestionType))}
          >
            <SelectTrigger className="w-48" aria-label="Question type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={question.channel}
            onValueChange={(channel) => onChange({ ...question, channel: channel as Channel })}
          >
            <SelectTrigger className="w-40" aria-label="Where it is asked">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['form', 'whatsapp'] as const).map((c) => (
                <SelectItem key={c} value={c} disabled={!allowedChannels.includes(c)}>
                  {CHANNEL_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => onMove(index - 1)}
            >
              <ArrowUp />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Move down"
              disabled={index === count - 1}
              onClick={() => onMove(index + 1)}
            >
              <ArrowDown />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Delete question" onClick={onDelete}>
              <Trash2 />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-prompt`}>{isBooking ? 'What the bot says' : 'Question'}</Label>
          <Textarea
            id={`${id}-prompt`}
            value={question.prompt}
            rows={2}
            placeholder={isBooking ? 'e.g. When suits you?' : 'e.g. What is your budget?'}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            You can use <code>{'{{name}}'}</code>, <code>{'{{business}}'}</code> and earlier answers
            like <code>{'{{answers.some_key}}'}</code>.
          </p>
        </div>

        {isChoice && (
          <div className="flex flex-col gap-2">
            <Label>Choices</Label>
            {options.map((option, at) => (
              <div key={at} className="flex items-center gap-2">
                <Input
                  value={option.label}
                  aria-label={`Choice ${at + 1}`}
                  onChange={(e) => setOptionLabel(at, e.target.value)}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove choice ${at + 1}`}
                  onClick={() =>
                    onChange({ ...question, options: options.filter((_, i) => i !== at) })
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="self-start" onClick={addOption}>
              <Plus /> Add choice
            </Button>
          </div>
        )}

        {!isBooking && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {question.channel === 'form' && (
              <div className="flex items-center gap-2">
                <Switch
                  id={`${id}-required`}
                  checked={question.required ?? true}
                  onCheckedChange={(required) => onChange({ ...question, required })}
                />
                <Label htmlFor={`${id}-required`}>Required</Label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Label htmlFor={`${id}-key`} className="text-muted-foreground text-xs font-normal">
                Saved as
              </Label>
              <Input
                id={`${id}-key`}
                className="h-8 w-44 font-mono text-xs"
                value={question.key}
                onChange={(e) => onChange({ ...question, key: e.target.value })}
              />
            </div>
          </div>
        )}

        {issues.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="Problems with this question">
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
        )}
      </CardContent>
    </Card>
  );
}
