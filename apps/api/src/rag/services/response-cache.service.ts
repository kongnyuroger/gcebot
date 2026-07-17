import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { VectorSearchFilter } from './vector-search.service';

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const CACHE_KEY_PREFIX = 'qa-cache:';

// Time-sensitive questions shouldn't be served from a (possibly day-old)
// cache even though they're within the TTL window.
const SKIP_CACHE_KEYWORDS = ['latest', 'recent', 'new', '2025', '2026'];

@Injectable()
export class ResponseCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(ResponseCacheService.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    this.client = new Redis(redisUrl);
  }

  async getCached(question: string, filter: VectorSearchFilter): Promise<string[] | null> {
    if (this.shouldSkipCache(question)) {
      return null;
    }

    const raw = await this.client.get(this.cacheKey(question, filter));
    if (!raw) {
      return null;
    }

    this.logger.log('Cache hit for QA response');
    return JSON.parse(raw) as string[];
  }

  async setCache(question: string, filter: VectorSearchFilter, response: string[]): Promise<void> {
    if (this.shouldSkipCache(question)) {
      return;
    }

    await this.client.set(
      this.cacheKey(question, filter),
      JSON.stringify(response),
      'EX',
      CACHE_TTL_SECONDS,
    );
  }

  private shouldSkipCache(question: string): boolean {
    const lower = question.toLowerCase();
    const currentYear = String(new Date().getFullYear());

    return (
      SKIP_CACHE_KEYWORDS.some((keyword) => lower.includes(keyword)) || lower.includes(currentYear)
    );
  }

  private cacheKey(question: string, filter: VectorSearchFilter): string {
    const normalizedQuestion = question.trim().toLowerCase().replace(/\s+/g, ' ');

    const normalizedFilter = (Object.keys(filter) as Array<keyof VectorSearchFilter>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const value = filter[key];
        if (value !== undefined) {
          acc[key] = value;
        }
        return acc;
      }, {});

    const hash = createHash('sha256')
      .update(`${normalizedQuestion}::${JSON.stringify(normalizedFilter)}`)
      .digest('hex');

    return `${CACHE_KEY_PREFIX}${hash}`;
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
