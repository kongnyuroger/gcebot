import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionContext } from '@gcebot/shared';
import Redis from 'ioredis';

const SESSION_TTL_SECONDS = 60 * 60 * 2; // 2 hours

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(redisUrl);
  }

  private key(phone: string): string {
    return `session:${phone}`;
  }

  async getSession(phone: string): Promise<SessionContext | null> {
    const raw = await this.client.get(this.key(phone));
    return raw ? (JSON.parse(raw) as SessionContext) : null;
  }

  async setSession(phone: string, ctx: SessionContext): Promise<void> {
    await this.client.set(this.key(phone), JSON.stringify(ctx), 'EX', SESSION_TTL_SECONDS);
  }

  async updateSessionField<K extends keyof SessionContext>(
    phone: string,
    field: K,
    value: SessionContext[K],
  ): Promise<void> {
    const existing = (await this.getSession(phone)) ?? ({} as SessionContext);
    existing[field] = value;
    await this.setSession(phone, existing);
  }

  async clearSession(phone: string): Promise<void> {
    await this.client.del(this.key(phone));
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
