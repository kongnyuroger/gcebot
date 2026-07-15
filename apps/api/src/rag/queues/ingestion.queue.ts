import { ChunkMetadata } from '../services/chunking.service';

export const INGESTION_QUEUE_NAME = 'document-ingestion';

export interface IngestionJobPayload {
  documentId: string;
  filePath: string;
  metadata: ChunkMetadata;
}
