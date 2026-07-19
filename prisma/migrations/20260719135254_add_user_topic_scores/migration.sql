-- DropIndex
DROP INDEX "embedding_chunks_embedding_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "topicScores" JSONB;
