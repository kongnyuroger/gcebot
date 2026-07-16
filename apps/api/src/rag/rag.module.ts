import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { ChunkingService } from './services/chunking.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorStoreService } from './services/vector-store.service';
import { VectorSearchService } from './services/vector-search.service';
import { PromptAssemblerService } from './services/prompt-assembler.service';
import { LlmService } from './services/llm.service';
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
  ],
  providers: [
    PdfExtractorService,
    ChunkingService,
    EmbeddingService,
    VectorStoreService,
    VectorSearchService,
    PromptAssemblerService,
    LlmService,
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
    IngestionService,
  ],
})
export class RagModule {}
