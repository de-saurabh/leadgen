import { parseWebhook } from '../whatsapp/webhook.js';
import type { TestContext } from './helpers.js';

type Row = { id: string; title: string; description?: string };

/** Plays a customer chatting with the bot through the webhook, against a fake Meta. */
export function createChat(ctx: TestContext, phoneNumberId: string) {
  let seq = 0;
  const payload = (messages: unknown[]) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          { field: 'messages', value: { metadata: { phone_number_id: phoneNumberId }, messages } },
        ],
      },
    ],
  });
  const receive = (messages: unknown[]) =>
    ctx.conversations.handleWebhook(parseWebhook(payload(messages)));

  const lastMessage = () =>
    ctx.graph.sent.at(-1)!.message as { kind: string; body: string; options?: Row[] };
  const rows = () => lastMessage().options ?? [];
  const rowWith = (part: string) => {
    const row = rows().find((r) => r.id.includes(part));
    if (!row) throw new Error(`no option "${part}" in ${JSON.stringify(rows())}`);
    return row;
  };

  return {
    receive,
    say: (from: string, body: string) =>
      receive([{ id: `wamid.chat.${++seq}`, from, type: 'text', text: { body } }]),
    tap: (from: string, id: string) =>
      receive([
        {
          id: `wamid.chat.${++seq}`,
          from,
          type: 'interactive',
          interactive: { type: 'list_reply', list_reply: { id, title: '' } },
        },
      ]),
    lastMessage,
    rows,
    rowWith,
    /** The last day offered: a full future day, unlike today, which may be half over. */
    fullDay: () =>
      rows()
        .filter((r) => r.id.includes(':d'))
        .at(-1)!,
  };
}
