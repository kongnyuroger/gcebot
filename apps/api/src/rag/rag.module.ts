import { Module } from '@nestjs/common';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { ChunkingService } from './services/chunking.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorStoreService } from './services/vector-store.service';

@Module({
  providers: [PdfExtractorService, ChunkingService, EmbeddingService, VectorStoreService],
  exports: [PdfExtractorService, ChunkingService, EmbeddingService, VectorStoreService],
})
export class RagModule {}
