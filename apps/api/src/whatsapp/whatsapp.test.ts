import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GraphError, createGraphClient, toGraphPayload } from './graph.js';
import { parseWebhook, verifySignature } from './webhook.js';

describe('toGraphPayload', () => {
  it('builds text, buttons, list and template messages', () => {
    expect(toGraphPayload('91', { kind: 'text', body: 'hi' })).toMatchObject({
      to: '91',
      type: 'text',
      text: { body: 'hi' },
    });

    const buttons = toGraphPayload('91', {
      kind: 'buttons',
      body: 'Sure?',
      options: [{ id: 'q:yes', title: 'Yes' }],
    }) as { interactive: { type: string; action: { buttons: unknown[] } } };
    expect(buttons.interactive.type).toBe('button');
    expect(buttons.interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'q:yes', title: 'Yes' } },
    ]);

    const list = toGraphPayload('91', {
      kind: 'list',
      body: 'Pick',
      buttonText: 'Choose',
      options: [
        { id: 'q:a', title: 'A', description: 'first' },
        { id: 'q:b', title: 'B' },
      ],
    }) as { interactive: { action: { button: string; sections: Array<{ rows: unknown[] }> } } };
    expect(list.interactive.action.button).toBe('Choose');
    expect(list.interactive.action.sections[0]!.rows).toEqual([
      { id: 'q:a', title: 'A', description: 'first' },
      { id: 'q:b', title: 'B' },
    ]);

    expect(
      toGraphPayload('91', { kind: 'template', name: 'hello_world', language: 'en_US' }),
    ).toMatchObject({
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    });
    const withParams = toGraphPayload('91', {
      kind: 'template',
      name: 't',
      language: 'en',
      params: ['Asha'],
    }) as { template: { components: unknown[] } };
    expect(withParams.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Asha' }] },
    ]);
  });
});

describe('graph client', () => {
  const target = { phoneNumberId: '555', accessToken: 'secret-token' };

  it('posts to the versioned messages endpoint with the bearer token', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = createGraphClient({
      version: 'v26.0',
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return Response.json({ messages: [{ id: 'wamid.1' }] });
      }) as typeof fetch,
    });
    const result = await client.send(target, '91', { kind: 'text', body: 'hi' });
    expect(result).toEqual({ waMessageId: 'wamid.1' });
    expect(seen!.url).toBe('https://graph.facebook.com/v26.0/555/messages');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer secret-token',
    );
  });

  it('turns an API error into a GraphError without leaking the token', async () => {
    const client = createGraphClient({
      version: 'v26.0',
      fetch: (async () =>
        Response.json(
          { error: { message: 'Recipient not allowed', code: 131030 } },
          { status: 400 },
        )) as typeof fetch,
    });
    const error = await client.send(target, '91', { kind: 'text', body: 'hi' }).catch((e) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect(error).toMatchObject({ status: 400, code: 131030, message: 'Recipient not allowed' });
    expect(String(error.stack)).not.toContain('secret-token');
  });

  it('treats an ok response without a message id as a failure', async () => {
    const client = createGraphClient({
      version: 'v26.0',
      fetch: (async () => Response.json({})) as typeof fetch,
    });
    await expect(client.send(target, '91', { kind: 'text', body: 'x' })).rejects.toBeInstanceOf(
      GraphError,
    );
  });
});

describe('verifySignature', () => {
  const body = Buffer.from('{"a":1}');
  const sign = (secret: string) =>
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('accepts a valid signature only', () => {
    expect(verifySignature(body, sign('s3cret'), 's3cret')).toBe(true);
    expect(verifySignature(body, sign('other'), 's3cret')).toBe(false);
    expect(verifySignature(Buffer.from('{"a":2}'), sign('s3cret'), 's3cret')).toBe(false);
    expect(verifySignature(body, undefined, 's3cret')).toBe(false);
    expect(verifySignature(body, 'sha256=zz', 's3cret')).toBe(false);
    expect(verifySignature(body, 'md5=abc', 's3cret')).toBe(false);
  });
});

function payload(value: Record<string, unknown>, field = 'messages') {
  return { object: 'whatsapp_business_account', entry: [{ changes: [{ field, value }] }] };
}
const metadata = { phone_number_id: 'PN1' };

describe('parseWebhook', () => {
  it('reads text, button and list replies, and other media', () => {
    const parsed = parseWebhook(
      payload({
        metadata,
        messages: [
          { id: 'm1', from: '+91 98765', type: 'text', text: { body: 'hello' } },
          {
            id: 'm2',
            from: '9198765',
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'q:yes', title: 'Yes' } },
          },
          {
            id: 'm3',
            from: '9198765',
            type: 'interactive',
            interactive: { type: 'list_reply', list_reply: { id: 'q:a', title: 'A' } },
          },
          { id: 'm4', from: '9198765', type: 'image', image: {} },
          {
            id: 'm5',
            from: '9198765',
            type: 'button',
            button: { payload: 'cancel', text: 'Cancel' },
          },
        ],
      }),
    );
    expect(parsed.messages.map((m) => [m.waMessageId, m.message])).toEqual([
      ['m1', { kind: 'text', body: 'hello' }],
      ['m2', { kind: 'reply', id: 'q:yes', title: 'Yes' }],
      ['m3', { kind: 'reply', id: 'q:a', title: 'A' }],
      ['m4', { kind: 'other', type: 'image' }],
      ['m5', { kind: 'reply', id: 'cancel', title: 'Cancel' }],
    ]);
    expect(parsed.messages[0]).toMatchObject({ phoneNumberId: 'PN1', from: '9198765' });
  });

  it('reads delivery statuses', () => {
    const parsed = parseWebhook(
      payload({ metadata, statuses: [{ id: 'wamid.1', status: 'delivered', recipient_id: '91' }] }),
    );
    expect(parsed).toEqual({
      messages: [],
      statuses: [{ waMessageId: 'wamid.1', status: 'delivered' }],
    });
  });

  it('ignores other fields and malformed entries without throwing', () => {
    expect(parseWebhook(payload({ metadata, messages: [] }, 'account_update'))).toEqual({
      messages: [],
      statuses: [],
    });
    for (const junk of [
      null,
      'x',
      42,
      {},
      { entry: 'no' },
      { entry: [null, { changes: [null, { field: 'messages' }] }] },
    ]) {
      expect(parseWebhook(junk)).toEqual({ messages: [], statuses: [] });
    }
    expect(
      parseWebhook(payload({ metadata, messages: [{ type: 'text' }, { id: 'x' }] })).messages,
    ).toEqual([]);
    expect(
      parseWebhook(payload({ messages: [{ id: 'a', from: '1', type: 'text' }] })).messages,
    ).toEqual([]);
  });
});
