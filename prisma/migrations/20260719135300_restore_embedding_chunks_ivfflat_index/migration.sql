-- The preceding migration (add_user_topic_scores) unintentionally dropped this
-- index: Prisma's schema diffing can't see indexes on Unsupported("vector(n)")
-- columns, so it treats a manually-created ivfflat index as drift and emits a
-- DropIndex for it on every migration touching this schema, regardless of what
-- actually changed. Restoring it here. See the original migration
-- (20260716120000_add_embedding_chunks_ivfflat_index) for the index's rationale.
CREATE INDEX IF NOT EXISTS embedding_chunks_embedding_idx ON embedding_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
