import { Module } from '@nestjs/common';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { ChunkingService } from './services/chunking.service';

@Module({
  providers: [PdfExtractorService, ChunkingService],
  exports: [PdfExtractorService, ChunkingService],
})
export class RagModule {}
