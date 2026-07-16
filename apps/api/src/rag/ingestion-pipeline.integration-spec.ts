import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Job } from 'bull';
import { IngestionStatus } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { PdfExtractorService } from './services/pdf-extractor.service';
import { ChunkingService } from './services/chunking.service';
import { EmbeddingService } from './services/embedding.service';
import { VectorStoreService } from './services/vector-store.service';
import { IngestionProcessor } from './processors/ingestion.processor';
import { IngestionJobPayload } from './queues/ingestion.queue';
import { buildGceBiologySamplePdf } from '../../test/fixtures/gce-biology-sample';

describe('RAG ingestion pipeline (integration)', () => {
  const documentId = 'test-integration-rag-doc-1';
  const fixtureDir = join(__dirname, '../../test/tmp');
  const filePath = join(fixtureDir, `${documentId}.pdf`);

  let prisma: PrismaService;
  let processor: IngestionProcessor;
  let generateEmbeddings: jest.Mock;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(filePath, await buildGceBiologySamplePdf());

    // Mock only the OpenAI-backed embedding service - everything else (PDF
    // extraction, chunking, Postgres/pgvector storage) runs for real.
    generateEmbeddings = jest.fn(async (chunks: string[]) =>
      chunks.map(() => new Array(1536).fill(0.01)),
    );
    const embeddingService = { generateEmbeddings } as unknown as EmbeddingService;

    processor = new IngestionProcessor(
      prisma,
      new PdfExtractorService(),
      new ChunkingService(),
      embeddingService,
      new VectorStoreService(prisma),
    );
  });

  afterEach(async () => {
    await prisma.embeddingChunk.deleteMany({ where: { documentId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
    generateEmbeddings.mockClear();
  });

  afterAll(async () => {
    rmSync(fixtureDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it('runs extract -> chunk -> embed -> store end to end and marks the document COMPLETE', async () => {
    await prisma.document.create({
      data: {
        id: documentId,
        filename: 'gce-biology-sample.pdf',
        subject: 'Biology',
        level: 'O_LEVEL',
        docType: 'PAST_PAPER',
        year: 2023,
      },
    });

    const progress = jest.fn();
    const job = {
      data: {
        documentId,
        filePath,
        metadata: {
          documentId,
          subject: 'Biology',
          level: 'O_LEVEL',
          year: 2023,
          docType: 'PAST_PAPER',
        },
      },
      progress,
    } as unknown as Job<IngestionJobPayload>;

    await processor.handleIngestion(job);

    // Document status + chunk count
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.ingestionStatus).toBe(IngestionStatus.COMPLETE);
    expect(document.errorMessage).toBeNull();

    // This exact 2-page fixture is small enough to fit in a single chunk -
    // verified directly against ChunkingService while building it.
    expect(document.chunkCount).toBe(1);

    // Chunks actually exist in the DB, matching Document.chunkCount
    const chunks = await prisma.embeddingChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
    });
    expect(chunks).toHaveLength(document.chunkCount);

    // Metadata properly tagged on every chunk
    for (const chunk of chunks) {
      expect(chunk.subject).toBe('Biology');
      expect(chunk.level).toBe('O_LEVEL');
      expect(chunk.year).toBe(2023);
    }
    expect(chunks[0].topic).toBe('SECTION A');
    expect(chunks[0].content).toContain('SECTION A');
    expect(chunks[0].content).toContain('SECTION B');
    expect(chunks[0].content).toContain('ORGANIC CHEMISTRY OF LIFE');
    // Running header/footer must have been stripped, not stored as content.
    expect(chunks[0].content).not.toContain('GCE ORDINARY LEVEL');
    expect(chunks[0].content).not.toContain('Page 1 of 2');

    // Embeddings genuinely stored as pgvector vectors, not just text
    const [{ dims }] = await prisma.$queryRaw<{ dims: number }[]>`
      SELECT vector_dims(embedding) as dims FROM embedding_chunks WHERE "documentId" = ${documentId} LIMIT 1
    `;
    expect(dims).toBe(1536);

    // The mocked embedding service was actually invoked (not bypassed)
    expect(generateEmbeddings).toHaveBeenCalledTimes(1);

    // Progress checkpoints fired in order
    expect(progress.mock.calls.map((call) => call[0])).toEqual([10, 30, 60, 90, 100]);
  });

  it('marks the document FAILED with the real error message when extraction fails', async () => {
    await prisma.document.create({
      data: {
        id: documentId,
        filename: 'missing.pdf',
        subject: 'Biology',
        level: 'O_LEVEL',
        docType: 'PAST_PAPER',
      },
    });

    const job = {
      data: {
        documentId,
        filePath: join(fixtureDir, 'this-file-does-not-exist.pdf'),
        metadata: { documentId, subject: 'Biology', level: 'O_LEVEL', docType: 'PAST_PAPER' },
      },
      progress: jest.fn(),
    } as unknown as Job<IngestionJobPayload>;

    await expect(processor.handleIngestion(job)).rejects.toThrow();

    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.ingestionStatus).toBe(IngestionStatus.FAILED);
    expect(document.errorMessage).toContain('ENOENT');
  });
});
