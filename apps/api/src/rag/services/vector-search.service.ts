import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

export interface VectorSearchFilter {
  subject?: string;
  level?: string;
  topic?: string;
  year?: number;
  docType?: string;
}

export interface SearchResult {
  chunkId: string;
  content: string;
  subject: string;
  level: string;
  topic?: string;
  year?: number;
  // Not part of the task's literal SearchResult spec, but embedding_chunks has
  // no docType column of its own (it lives on the parent Document) - without
  // it here, the Step 2 prompt assembler's citation format ([Source: {docType},
  // {year}]) would have nothing to cite. Fetched via a join, no schema change.
  docType: string;
  similarity: number;
}

interface RawSearchRow {
  chunkId: string;
  content: string;
  subject: string;
  level: string;
  topic: string | null;
  year: number | null;
  docType: string;
  similarity: number;
}

const DEFAULT_TOP_K = 5;
const SIMILARITY_THRESHOLD = 0.3;

@Injectable()
export class VectorSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async search(
    query: string,
    filter: VectorSearchFilter,
    topK: number = DEFAULT_TOP_K,
  ): Promise<SearchResult[]> {
    const [embedding] = await this.embeddingService.generateEmbeddings([query]);
    const embeddingLiteral = `[${embedding.join(',')}]`;

    const conditions: Prisma.Sql[] = [];
    if (filter.subject) {
      conditions.push(Prisma.sql`ec.subject = ${filter.subject}`);
    }
    if (filter.level) {
      conditions.push(Prisma.sql`ec.level = ${filter.level}::"Level"`);
    }
    if (filter.topic) {
      conditions.push(Prisma.sql`ec.topic = ${filter.topic}`);
    }
    if (filter.year !== undefined) {
      conditions.push(Prisma.sql`ec.year = ${filter.year}`);
    }
    if (filter.docType) {
      conditions.push(Prisma.sql`d."docType" = ${filter.docType}::"DocType"`);
    }

    const whereClause =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<RawSearchRow[]>(Prisma.sql`
      SELECT ec.id as "chunkId", ec.content, ec.subject, ec.level, ec.topic, ec.year, d."docType" as "docType",
             1 - (ec.embedding <=> ${embeddingLiteral}::vector) as similarity
      FROM embedding_chunks ec
      JOIN documents d ON d.id = ec."documentId"
      ${whereClause}
      ORDER BY ec.embedding <=> ${embeddingLiteral}::vector
      LIMIT ${topK}
    `);

    return rows
      .filter((row) => row.similarity >= SIMILARITY_THRESHOLD)
      .map((row) => ({
        chunkId: row.chunkId,
        content: row.content,
        subject: row.subject,
        level: row.level,
        topic: row.topic ?? undefined,
        year: row.year ?? undefined,
        docType: row.docType,
        similarity: row.similarity,
      }));
  }
}
