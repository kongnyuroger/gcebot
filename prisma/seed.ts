import { PrismaClient } from '../apps/api/generated/prisma';

const prisma = new PrismaClient();

const FREE_USER_PHONE = '+237670000001';
const PREMIUM_USER_PHONE = '+237680000002';
const SEED_DOCUMENT_ID = 'seed-doc-biology-o-level-2023';

async function main() {
  const freeUser = await prisma.user.upsert({
    where: { phone_number: FREE_USER_PHONE },
    update: {},
    create: {
      phone_number: FREE_USER_PHONE,
      level: 'O_LEVEL',
      subjects: ['Biology', 'Chemistry'],
      tier: 'FREE',
      language: 'EN',
      referralCode: 'FREE-AB12',
    },
  });

  const premiumUser = await prisma.user.upsert({
    where: { phone_number: PREMIUM_USER_PHONE },
    update: {},
    create: {
      phone_number: PREMIUM_USER_PHONE,
      level: 'A_LEVEL',
      subjects: ['Mathematics', 'Physics'],
      tier: 'PREMIUM',
      language: 'EN',
      referralCode: 'PREM-CD34',
    },
  });

  await prisma.subscription.upsert({
    where: { userId: premiumUser.phone_number },
    update: {},
    create: {
      userId: premiumUser.phone_number,
      tier: 'PREMIUM',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      paymentMethod: 'MTN_MOMO',
      paymentReference: 'MOMO-SEED-0001',
    },
  });

  const document = await prisma.document.upsert({
    where: { id: SEED_DOCUMENT_ID },
    update: {},
    create: {
      id: SEED_DOCUMENT_ID,
      filename: 'biology-o-level-past-paper-2023.pdf',
      subject: 'Biology',
      level: 'O_LEVEL',
      docType: 'PAST_PAPER',
      year: 2023,
      ingestionStatus: 'COMPLETE',
      chunkCount: 3,
    },
  });

  // EmbeddingChunk.embedding is Unsupported("vector(1536)"), so Prisma Client can't
  // set it through create() at all - it must go through raw SQL, per the pgvector
  // coding standard (raw SQL only for pgvector operations).
  const dummyEmbedding = `[${Array(1536).fill(0.01).join(',')}]`;

  for (let i = 0; i < 3; i++) {
    const chunkId = `${SEED_DOCUMENT_ID}-chunk-${i}`;
    await prisma.$executeRaw`
      INSERT INTO embedding_chunks
        (id, "documentId", content, embedding, subject, level, topic, year, "chunkIndex", "createdAt")
      VALUES
        (${chunkId}, ${document.id}, ${`Sample Biology O-Level 2023 past paper chunk ${i + 1}`}, ${dummyEmbedding}::vector, 'Biology', 'O_LEVEL', 'Cell Biology', 2023, ${i}, now())
      ON CONFLICT (id) DO NOTHING
    `;
  }

  console.log('Seed complete:', {
    freeUser: freeUser.phone_number,
    premiumUser: premiumUser.phone_number,
    document: document.id,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
