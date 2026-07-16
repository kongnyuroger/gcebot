import { readFile } from 'fs/promises';
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { IngestionStatus } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { PdfExtractorService } from '../services/pdf-extractor.service';
import { ChunkingService } from '../services/chunking.service';
import { EmbeddingService } from '../services/embedding.service';
import { VectorStoreService } from '../services/vector-store.service';
import { INGESTION_QUEUE_NAME, IngestionJobPayload } from '../queues/ingestion.queue';

@Processor(INGESTION_QUEUE_NAME)
export class IngestionProcessor {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfExtractor: PdfExtractorService,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStore: VectorStoreService,
  ) {}

  @Process()
  async handleIngestion(job: Job<IngestionJobPayload>): Promise<void> {
    const { documentId, filePath, metadata } = job.data;

    try {
      await this.prisma.document.update({
        where: { id: documentId },
        data: { ingestionStatus: IngestionStatus.PROCESSING },
      });
      await job.progress(10);

      const buffer = await readFile(filePath);
      const { text } = await this.pdfExtractor.extractText(buffer);
      await job.progress(30);

      const chunks = this.chunkingService.chunkText(text, metadata);
      await job.progress(60);

      const embeddings = await this.embeddingService.generateEmbeddings(
        chunks.map((chunk) => chunk.content),
      );
      await job.progress(90);

      const toStore = chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] }));
      await this.vectorStore.storeChunks(toStore);

      await this.prisma.document.update({
        where: { id: documentId },
        data: { ingestionStatus: IngestionStatus.COMPLETE },
      });
      await job.progress(100);

      this.logger.log(`Ingestion complete for document ${documentId} (${chunks.length} chunks)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Ingestion failed for document ${documentId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.prisma.document.update({
        where: { id: documentId },
        data: { ingestionStatus: IngestionStatus.FAILED, errorMessage: message },
      });

      // Re-throw so Bull's own job-failure tracking (used by retryIngestion in
      // Step 6, and visible to any @OnQueueFailed listeners) reflects this too.
      throw error;
    }
  }
}
