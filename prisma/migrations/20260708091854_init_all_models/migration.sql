/*
  Warnings:

  - You are about to drop the `DocumentChunk` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "Level" AS ENUM ('O_LEVEL', 'A_LEVEL');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'BASIC', 'PREMIUM', 'FAMILY');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'FR');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MTN_MOMO', 'ORANGE_MONEY');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('SYLLABUS', 'PAST_PAPER', 'TEXTBOOK', 'MARKING_SCHEME');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('QA', 'PRACTICE', 'MOCK_EXAM', 'MILESTONE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED');

-- DropTable
DROP TABLE "DocumentChunk";

-- CreateTable
CREATE TABLE "users" (
    "phone_number" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "subjects" TEXT[],
    "tier" "SubscriptionTier" NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "streakDays" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDate" TIMESTAMP(3),
    "referralCode" TEXT NOT NULL,
    "referredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("phone_number")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "docType" "DocType" NOT NULL,
    "year" INTEGER,
    "ingestionStatus" "IngestionStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "subject" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "topic" TEXT,
    "year" INTEGER,
    "chunkIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embedding_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "InteractionType" NOT NULL,
    "subject" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "userAnswer" TEXT NOT NULL,
    "correct" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_exams" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "score" INTEGER,
    "maxScore" INTEGER,
    "topicBreakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_conversions" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "newUserId" TEXT NOT NULL,
    "rewardGrantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XAF',
    "provider" "PaymentMethod" NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_conversions_newUserId_key" ON "referral_conversions"("newUserId");

-- CreateIndex
CREATE UNIQUE INDEX "pending_payments_externalId_key" ON "pending_payments"("externalId");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("phone_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embedding_chunks" ADD CONSTRAINT "embedding_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("phone_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("phone_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "users"("phone_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_newUserId_fkey" FOREIGN KEY ("newUserId") REFERENCES "users"("phone_number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_payments" ADD CONSTRAINT "pending_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("phone_number") ON DELETE RESTRICT ON UPDATE CASCADE;
