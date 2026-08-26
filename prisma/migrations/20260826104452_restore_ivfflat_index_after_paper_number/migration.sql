-- The preceding migration (add_paper_number) unintentionally dropped this
-- index for the same reason documented in 20260719135300_restore_embedding_chunks_ivfflat_index:
-- Prisma's schema diffing can't see indexes on Unsupported("vector(n)") columns,
-- so it treats a manually-created ivfflat index as drift and emits a DropIndex
-- on every migration that touches this schema. Restoring it here.
CREATE INDEX IF NOT EXISTS embedding_chunks_embedding_idx ON embedding_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
