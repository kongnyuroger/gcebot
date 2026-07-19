import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Level, Language, SubscriptionTier, User, Prisma } from '../../generated/prisma';

const REFERRAL_CODE_GENERATION_ATTEMPTS = 5;

function generateReferralCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

function isUniqueConstraintViolation(error: unknown, field: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.target as string[] | undefined)?.includes(field) === true
  );
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isNewUser(phone: string): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { phone_number: phone } });
    return count === 0;
  }

  async upsertUser(phone: string): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { phone_number: phone } });

    if (existing) {
      return existing;
    }

    return this.createUser(phone);
  }

  private async createUser(phone: string, attempt = 0): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          phone_number: phone,
          // Placeholder until the user completes LEVEL_SELECTION during onboarding -
          // the `level` column is NOT NULL with no natural default in the schema.
          level: Level.O_LEVEL,
          subjects: [],
          tier: SubscriptionTier.FREE,
          referralCode: generateReferralCode(),
        },
      });
    } catch (error) {
      if (
        isUniqueConstraintViolation(error, 'referralCode') &&
        attempt < REFERRAL_CODE_GENERATION_ATTEMPTS
      ) {
        this.logger.warn(`Referral code collision, retrying (attempt ${attempt + 1})`);
        return this.createUser(phone, attempt + 1);
      }
      throw error;
    }
  }

  async getUserProfile(phone: string) {
    return this.prisma.user.findUnique({
      where: { phone_number: phone },
      include: { subscription: true },
    });
  }

  async updateLevel(phone: string, level: Level): Promise<User> {
    return this.prisma.user.update({ where: { phone_number: phone }, data: { level } });
  }

  async updateSubjects(phone: string, subjects: string[]): Promise<User> {
    return this.prisma.user.update({ where: { phone_number: phone }, data: { subjects } });
  }

  async updateLanguage(phone: string, language: Language): Promise<User> {
    return this.prisma.user.update({ where: { phone_number: phone }, data: { language } });
  }
}
