import { Injectable, Logger } from '@nestjs/common';

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

interface WhatsAppContact {
  profile?: { name?: string };
  wa_id?: string;
}

interface WhatsAppWebhookValue {
  messages?: WhatsAppMessage[];
  statuses?: unknown[];
  contacts?: WhatsAppContact[];
}

interface WhatsAppWebhookChange {
  value: WhatsAppWebhookValue;
  field: string;
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

export interface ParsedMessage {
  from: string; // sender phone number
  messageId: string; // WhatsApp message ID
  timestamp: number;
  type: 'text' | 'button_reply' | 'list_reply' | 'unknown';
  text?: string; // for text messages
  buttonId?: string; // for button replies
  buttonText?: string;
  listId?: string; // for list replies
  listTitle?: string;
  contactName?: string; // sender's WhatsApp display name, if Meta included one
}

@Injectable()
export class MessageParserService {
  private readonly logger = new Logger(MessageParserService.name);

  parse(body: WhatsAppWebhookPayload): ParsedMessage | null {
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      // No `messages` array means this is a status update (sent/delivered/read)
      // or an otherwise irrelevant webhook event - nothing to route.
      return null;
    }

    const value = body.entry[0].changes[0].value;

    const base = {
      from: message.from,
      messageId: message.id,
      timestamp: Number(message.timestamp),
      contactName: value.contacts?.[0]?.profile?.name,
    };

    if (message.type === 'text' && message.text) {
      return { ...base, type: 'text', text: message.text.body };
    }

    if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
      return {
        ...base,
        type: 'button_reply',
        buttonId: message.interactive.button_reply?.id,
        buttonText: message.interactive.button_reply?.title,
      };
    }

    if (message.type === 'interactive' && message.interactive?.type === 'list_reply') {
      return {
        ...base,
        type: 'list_reply',
        listId: message.interactive.list_reply?.id,
        listTitle: message.interactive.list_reply?.title,
      };
    }

    this.logger.debug(`Unhandled message type: ${message.type}`);
    return { ...base, type: 'unknown' };
  }
}
