-- CreateEnum
CREATE TYPE "BroadcastTarget" AS ENUM ('ALL', 'TIER', 'SUBJECT', 'LEVEL');

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "target" "BroadcastTarget" NOT NULL,
    "targetValue" TEXT,
    "scheduleAt" TIMESTAMP(3),
    "status" "BroadcastStatus" NOT NULL DEFAULT 'SCHEDULED',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);
