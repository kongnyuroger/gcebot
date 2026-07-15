-- CreateIndex
-- ivfflat index for approximate nearest-neighbor search on embedding_chunks.embedding,
-- using cosine distance (matches the similarity metric the RAG retrieval layer will use).
-- lists = 100 is a reasonable starting point; per pgvector's guidance this should
-- ideally be tuned to roughly sqrt(row_count) once the corpus is large enough to matter.
CREATE INDEX IF NOT EXISTS embedding_chunks_embedding_idx ON embedding_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
