import { MessageParserService, WhatsAppWebhookPayload } from './message-parser.service';

describe('MessageParserService', () => {
  let service: MessageParserService;

  beforeEach(() => {
    service = new MessageParserService();
  });

  function buildPayload(value: Record<string, unknown>): WhatsAppWebhookPayload {
    return {
      object: 'whatsapp_business_account',
      entry: [{ id: 'entry-1', changes: [{ field: 'messages', value }] }],
    } as unknown as WhatsAppWebhookPayload;
  }

  it('parses a text message', () => {
    const payload = buildPayload({
      messages: [
        {
          from: '237670000001',
          id: 'wamid.TEXT',
          timestamp: '1720000000',
          type: 'text',
          text: { body: 'Hello' },
        },
      ],
    });

    expect(service.parse(payload)).toEqual({
      from: '237670000001',
      messageId: 'wamid.TEXT',
      timestamp: 1720000000,
      type: 'text',
      text: 'Hello',
    });
  });

  it('parses a button reply', () => {
    const payload = buildPayload({
      messages: [
        {
          from: '237670000001',
          id: 'wamid.BTN',
          timestamp: '1720000001',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'btn-1', title: 'Yes' } },
        },
      ],
    });

    expect(service.parse(payload)).toEqual({
      from: '237670000001',
      messageId: 'wamid.BTN',
      timestamp: 1720000001,
      type: 'button_reply',
      buttonId: 'btn-1',
      buttonText: 'Yes',
    });
  });

  it('parses a list reply', () => {
    const payload = buildPayload({
      messages: [
        {
          from: '237670000001',
          id: 'wamid.LIST',
          timestamp: '1720000002',
          type: 'interactive',
          interactive: {
            type: 'list_reply',
            list_reply: { id: 'list-1', title: 'Biology', description: 'O-Level' },
          },
        },
      ],
    });

    expect(service.parse(payload)).toEqual({
      from: '237670000001',
      messageId: 'wamid.LIST',
      timestamp: 1720000002,
      type: 'list_reply',
      listId: 'list-1',
      listTitle: 'Biology',
    });
  });

  it('returns type "unknown" for unsupported message types', () => {
    const payload = buildPayload({
      messages: [{ from: '237670000001', id: 'wamid.IMG', timestamp: '1720000003', type: 'image' }],
    });

    expect(service.parse(payload)).toEqual({
      from: '237670000001',
      messageId: 'wamid.IMG',
      timestamp: 1720000003,
      type: 'unknown',
    });
  });

  it('returns null for a status update', () => {
    const payload = buildPayload({
      statuses: [{ id: 'wamid.TEXT', status: 'delivered', timestamp: '1720000004' }],
    });

    expect(service.parse(payload)).toBeNull();
  });

  it('returns null when there is no entry at all', () => {
    expect(service.parse({ object: 'whatsapp_business_account', entry: [] })).toBeNull();
  });
});
