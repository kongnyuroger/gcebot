import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { WhatsappSendService } from './whatsapp-send.service';

jest.mock('axios');

describe('WhatsappSendService', () => {
  let service: WhatsappSendService;
  let mockPost: jest.Mock;
  let mockUseInterceptor: jest.Mock;

  beforeEach(() => {
    mockPost = jest.fn().mockResolvedValue({ data: { messages: [{ id: 'wamid.SENT' }] } });
    mockUseInterceptor = jest.fn();

    (axios.create as jest.Mock).mockReturnValue({
      post: mockPost,
      interceptors: { response: { use: mockUseInterceptor } },
    });

    const configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          WHATSAPP_PHONE_NUMBER_ID: 'PNID',
          WHATSAPP_TOKEN: 'TEST_TOKEN',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    service = new WhatsappSendService(configService);
  });

  it('configures axios with the Graph API base URL and bearer token', () => {
    expect(axios.create).toHaveBeenCalledWith({
      baseURL: 'https://graph.facebook.com/v18.0/PNID/messages',
      headers: {
        Authorization: 'Bearer TEST_TOKEN',
        'Content-Type': 'application/json',
      },
    });
  });

  it('registers a retry interceptor on the response chain', () => {
    expect(mockUseInterceptor).toHaveBeenCalledWith(undefined, expect.any(Function));
  });

  it('sendText posts the correct payload', async () => {
    await service.sendText('237670000001', 'Hello there');

    expect(mockPost).toHaveBeenCalledWith('', {
      messaging_product: 'whatsapp',
      to: '237670000001',
      type: 'text',
      text: { body: 'Hello there' },
    });
  });

  it('sendButtons posts the correct payload', async () => {
    await service.sendButtons('237670000001', 'Pick one', [
      { id: 'a', title: 'Option A' },
      { id: 'b', title: 'Option B' },
    ]);

    expect(mockPost).toHaveBeenCalledWith('', {
      messaging_product: 'whatsapp',
      to: '237670000001',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Pick one' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'a', title: 'Option A' } },
            { type: 'reply', reply: { id: 'b', title: 'Option B' } },
          ],
        },
      },
    });
  });

  it('sendButtons rejects when given more than 3 buttons', async () => {
    const buttons = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
      { id: 'd', title: 'D' },
    ];

    await expect(service.sendButtons('237670000001', 'Pick one', buttons)).rejects.toThrow(
      'WhatsApp supports a maximum of 3 buttons, got 4',
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sendList posts the correct payload', async () => {
    await service.sendList('237670000001', 'Choose a subject', 'View subjects', [
      { title: 'Sciences', rows: [{ id: 'bio', title: 'Biology', description: 'O-Level' }] },
    ]);

    expect(mockPost).toHaveBeenCalledWith('', {
      messaging_product: 'whatsapp',
      to: '237670000001',
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: 'Choose a subject' },
        action: {
          button: 'View subjects',
          sections: [
            { title: 'Sciences', rows: [{ id: 'bio', title: 'Biology', description: 'O-Level' }] },
          ],
        },
      },
    });
  });

  it('markAsRead posts the correct payload', async () => {
    await service.markAsRead('wamid.INBOUND123');

    expect(mockPost).toHaveBeenCalledWith('', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.INBOUND123',
    });
  });
});
