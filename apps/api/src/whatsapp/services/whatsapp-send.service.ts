import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

export interface WhatsAppButton {
  id: string;
  title: string;
}

export interface WhatsAppListRow {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppListSection {
  title: string;
  rows: WhatsAppListRow[];
}

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

const MAX_RETRY_ATTEMPTS = 3;
const MAX_BUTTONS = 3;

@Injectable()
export class WhatsappSendService {
  private readonly logger = new Logger(WhatsappSendService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    const phoneNumberId = this.configService.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID');
    const token = this.configService.getOrThrow<string>('WHATSAPP_TOKEN');

    this.client = axios.create({
      baseURL: `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(undefined, (error: AxiosError) =>
      this.retryOnFailure(error),
    );
  }

  async sendText(to: string, text: string): Promise<void> {
    await this.client.post('', {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    });
  }

  async sendButtons(to: string, text: string, buttons: WhatsAppButton[]): Promise<void> {
    if (buttons.length > MAX_BUTTONS) {
      throw new Error(
        `WhatsApp supports a maximum of ${MAX_BUTTONS} buttons, got ${buttons.length}`,
      );
    }

    await this.client.post('', {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        action: {
          buttons: buttons.map((button) => ({
            type: 'reply',
            reply: { id: button.id, title: button.title },
          })),
        },
      },
    });
  }

  async sendList(
    to: string,
    text: string,
    buttonText: string,
    sections: WhatsAppListSection[],
  ): Promise<void> {
    await this.client.post('', {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text },
        action: {
          button: buttonText,
          sections,
        },
      },
    });
  }

  async markAsRead(messageId: string): Promise<void> {
    await this.client.post('', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }

  private async retryOnFailure(error: AxiosError): Promise<never> {
    const config = error.config as RetryableRequestConfig | undefined;

    if (!config || !this.isRetryable(error)) {
      return Promise.reject(error);
    }

    config.__retryCount = (config.__retryCount ?? 0) + 1;

    if (config.__retryCount > MAX_RETRY_ATTEMPTS) {
      return Promise.reject(error);
    }

    const delayMs = 2 ** config.__retryCount * 1000;
    this.logger.warn(
      `WhatsApp API request failed (${error.response?.status ?? error.code}), ` +
        `retrying attempt ${config.__retryCount}/${MAX_RETRY_ATTEMPTS} after ${delayMs}ms`,
    );

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return this.client.request(config);
  }

  private isRetryable(error: AxiosError): boolean {
    const status = error.response?.status;
    return status === 429 || (status !== undefined && status >= 500);
  }
}
