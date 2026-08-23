import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { SessionModule } from '../session/session.module';
import { UsersModule } from '../users/users.module';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { ChunkingService } from './services/chunking.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorStoreService } from './services/vector-store.service';
import { VectorSearchService } from './services/vector-search.service';
import { PromptAssemblerService } from './services/prompt-assembler.service';
import { LlmService } from './services/llm.service';
import { ResponseFormatterService } from './services/response-formatter.service';
import { ResponseCacheService } from './services/response-cache.service';
import { QaService } from './services/qa.service';
import { IngestionService } from './services/ingestion.service';
import { IngestionProcessor } from './processors/ingestion.processor';
import { INGESTION_QUEUE_NAME } from './queues/ingestion.queue';

@Module({
  imports: [
    BullModule.forRootAsync({
      // Bull's own URL-string parsing does not negotiate TLS correctly
      // against providers like Upstash that require it (rediss://) - the
      // connection just hangs forever instead of erroring, so every queue
      // registered against this connection (ingestion, mock-exam timers,
      // broadcasts) silently never processes a single job. Plain `ioredis`
      // (used directly by SessionService/ResponseCacheService) handles the
      // same URL correctly, which is what pointed at this being Bull's own
      // connection setup rather than a real Redis/network problem. Passing
      // parsed, explicit options instead sidesteps Bull's URL handling.
      useFactory: (configService: ConfigService) => {
        const redisUrl = new URL(configService.getOrThrow<string>('REDIS_URL'));
        return {
          redis: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port),
            username: redisUrl.username || undefined,
            password: redisUrl.password || undefined,
            tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: INGESTION_QUEUE_NAME }),
    SessionModule,
    UsersModule,
  ],
  providers: [
    PdfExtractorService,
    ChunkingService,
    EmbeddingService,
    VectorStoreService,
    VectorSearchService,
    PromptAssemblerService,
    LlmService,
    ResponseFormatterService,
    ResponseCacheService,
    QaService,
    IngestionProcessor,
    IngestionService,
  ],
  exports: [
    PdfExtractorService,
    ChunkingService,
    EmbeddingService,
    VectorStoreService,
    VectorSearchService,
    PromptAssemblerService,
    LlmService,
    ResponseFormatterService,
    ResponseCacheService,
    QaService,
    IngestionService,
  ],
})
export class RagModule {}
