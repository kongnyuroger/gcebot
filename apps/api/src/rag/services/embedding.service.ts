import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 100; // well within the API's 2048-input and 300k-total-token per-request limits
const MAX_RETRIES = 3;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('OPENAI_API_KEY'),
      // The SDK already retries with exponential backoff on 429/5xx/timeouts;
      // this just raises the retry count from its default of 2 to 3.
      maxRetries: MAX_RETRIES,
    });
  }

  async generateEmbeddings(chunks: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const batch of this.toBatches(chunks, BATCH_SIZE)) {
      try {
        const response = await this.client.embeddings.create({
          input: batch,
          model: EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIMENSIONS,
          // Explicit rather than relying on the SDK's implicit default (which
          // silently requests base64 and decodes it client-side) - simpler to
          // reason about and test for a value this important to get right.
          encoding_format: 'float',
        });

        // The API returns items in input order, but sort by index defensively.
        const sorted = [...response.data].sort((a, b) => a.index - b.index);
        results.push(...sorted.map((item) => item.embedding));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Embedding generation failed for a batch of ${batch.length}: ${message}`);
        throw error;
      }
    }

    return results;
  }

  private toBatches<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }
}
