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
      useFactory: (configService: ConfigService) => ({
        url: configService.getOrThrow<string>('REDIS_URL'),
      }),
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
