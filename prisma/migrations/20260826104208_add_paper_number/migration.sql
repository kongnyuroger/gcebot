-- DropIndex
DROP INDEX "embedding_chunks_embedding_idx";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "paperNumber" INTEGER;

-- AlterTable
ALTER TABLE "embedding_chunks" ADD COLUMN     "paperNumber" INTEGER;
