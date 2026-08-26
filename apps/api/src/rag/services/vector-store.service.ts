import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChunkWithMetadata } from './chunking.service';

export type ChunkToStore = ChunkWithMetadata & { embedding: number[] };

const STORE_BATCH_SIZE = 50; // keeps each transaction's statement count bounded

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  async storeChunks(chunks: ChunkToStore[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const documentId = chunks[0].metadata.documentId;

    for (const batch of this.toBatches(chunks, STORE_BATCH_SIZE)) {
      await this.prisma.$transaction(batch.map((chunk) => this.buildInsert(chunk)));
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: { chunkCount: chunks.length },
    });

    this.logger.log(`Stored ${chunks.length} chunks for document ${documentId}`);
  }

  private buildInsert(chunk: ChunkToStore) {
    const { documentId, subject, level, topic, year, paperNumber, chunkIndex } = chunk.metadata;
    const embeddingLiteral = `[${chunk.embedding.join(',')}]`;

    return this.prisma.$executeRaw`
      INSERT INTO embedding_chunks
        (id, "documentId", content, embedding, subject, level, topic, year, "paperNumber", "chunkIndex", "createdAt")
      VALUES
        (${randomUUID()}, ${documentId}, ${chunk.content}, ${embeddingLiteral}::vector, ${subject}, ${level}::"Level", ${topic ?? null}, ${year ?? null}, ${paperNumber ?? null}, ${chunkIndex}, NOW())
    `;
  }

  private toBatches<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }
}
