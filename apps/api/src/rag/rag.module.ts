import { Module } from '@nestjs/common';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { ChunkingService } from './services/chunking.service';
import { EmbeddingService } from './services/embedding.service';

@Module({
  providers: [PdfExtractorService, ChunkingService, EmbeddingService],
  exports: [PdfExtractorService, ChunkingService, EmbeddingService],
})
export class RagModule {}
