// One-off operational script to create the first SUPER_ADMIN account -
// deliberately NOT wired into `prisma.seed` (package.json), since that runs
// automatically on `db:seed`/`postinstall` alongside throwaway dev fixture
// data. Creating a real admin with a real password is a deliberate,
// interactively-invoked action instead.
//
// Usage:
//   ADMIN_SEED_EMAIL=you@example.com ADMIN_SEED_PASSWORD='a-strong-password' \
//     npm run db:seed:admin
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import { PrismaClient } from '../apps/api/generated/prisma';

const prisma = new PrismaClient();
const MIN_PASSWORD_LENGTH = 12;
const BCRYPT_SALT_ROUNDS = 12;

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    console.error(
      'Usage: ADMIN_SEED_EMAIL=you@example.com ADMIN_SEED_PASSWORD=... npm run db:seed:admin',
    );
    process.exitCode = 1;
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`ADMIN_SEED_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.error(`An admin with email ${email} already exists (id=${existing.id}).`);
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const secret = speakeasy.generateSecret({ name: `GCEBot Admin (${email})` });

  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      totpSecret: secret.base32,
      role: 'SUPER_ADMIN',
    },
  });

  console.log(`Created SUPER_ADMIN ${admin.email} (id=${admin.id}).`);
  console.log('');
  console.log('Scan this into an authenticator app (Google Authenticator, Authy, ...):');
  console.log(secret.otpauth_url);
  console.log('');
  console.log(`Or enter this secret manually: ${secret.base32}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
