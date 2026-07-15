import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { ChunkingService } from './services/chunking.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorStoreService } from './services/vector-store.service';
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
    IngestionProcessor,
    IngestionService,
  ],
  exports: [
    PdfExtractorService,
    ChunkingService,
    EmbeddingService,
    VectorStoreService,
    IngestionService,
  ],
})
export class RagModule {}
