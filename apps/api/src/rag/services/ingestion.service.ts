import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { Document, DocType, IngestionStatus, Level } from '../../../generated/prisma';
import { INGESTION_QUEUE_NAME, IngestionJobPayload } from '../queues/ingestion.queue';
import { ChunkMetadata } from './chunking.service';

// Local disk for now - no Cloudflare R2 SDK/credentials exist anywhere in this
// project yet, so building that path now would be speculative. Swapping this
// for R2 later only means changing saveFileLocally()/resolveFilePath(); the
// public ingestDocument()/retryIngestion() contracts stay the same.
const UPLOADS_DIR = join(__dirname, '../../../uploads');

export interface IngestDocumentMetadata {
  subject: string;
  level: Level;
  docType: DocType;
  year?: number;
  topic?: string;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(INGESTION_QUEUE_NAME) private readonly ingestionQueue: Queue<IngestionJobPayload>,
  ) {}

  async ingestDocument(
    file: Express.Multer.File,
    metadata: IngestDocumentMetadata,
  ): Promise<Document> {
    const document = await this.prisma.document.create({
      data: {
        filename: file.originalname,
        subject: metadata.subject,
        level: metadata.level,
        docType: metadata.docType,
        year: metadata.year,
        ingestionStatus: IngestionStatus.QUEUED,
      },
    });

    const filePath = await this.saveFileLocally(document.id, file.buffer);

    await this.ingestionQueue.add({
      documentId: document.id,
      filePath,
      metadata: this.toChunkMetadata(document.id, metadata),
    });

    this.logger.log(`Queued ingestion for document ${document.id} (${file.originalname})`);

    return document;
  }

  async getIngestionStatus(documentId: string): Promise<Document> {
    return this.findDocumentOrThrow(documentId);
  }

  async retryIngestion(documentId: string): Promise<Document> {
    const document = await this.findDocumentOrThrow(documentId);

    if (document.ingestionStatus !== IngestionStatus.FAILED) {
      throw new BadRequestException(
        `Document ${documentId} is not in a FAILED state (current: ${document.ingestionStatus})`,
      );
    }

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { ingestionStatus: IngestionStatus.QUEUED, errorMessage: null },
    });

    await this.ingestionQueue.add({
      documentId,
      filePath: this.resolveFilePath(documentId),
      metadata: this.toChunkMetadata(documentId, {
        subject: document.subject,
        level: document.level,
        docType: document.docType,
        year: document.year ?? undefined,
      }),
    });

    this.logger.log(`Re-queued ingestion for document ${documentId}`);

    return updated;
  }

  private toChunkMetadata(documentId: string, metadata: IngestDocumentMetadata): ChunkMetadata {
    return {
      documentId,
      subject: metadata.subject,
      level: metadata.level,
      year: metadata.year,
      docType: metadata.docType,
      topic: metadata.topic,
    };
  }

  private async findDocumentOrThrow(documentId: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });

    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }

    return document;
  }

  private resolveFilePath(documentId: string): string {
    return join(UPLOADS_DIR, `${documentId}.pdf`);
  }

  private async saveFileLocally(documentId: string, buffer: Buffer): Promise<string> {
    await mkdir(UPLOADS_DIR, { recursive: true });
    const filePath = this.resolveFilePath(documentId);
    await writeFile(filePath, buffer);
    return filePath;
  }
}
