import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Interaction,
  Prisma,
  Subscription,
  SubscriptionTier,
  User,
} from '../../../generated/prisma';

const USERS_PAGE_SIZE = 20;
const RECENT_INTERACTIONS_LIMIT = 20;

export interface PaginatedUsers {
  users: User[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface UserDetail extends User {
  subscription: Subscription | null;
  recentInteractions: Interaction[];
}

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(page = 1, search?: string, tier?: SubscriptionTier): Promise<PaginatedUsers> {
    const where: Prisma.UserWhereInput = {
      ...(search ? { phone_number: { contains: search } } : {}),
      ...(tier ? { tier } : {}),
    };

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * USERS_PAGE_SIZE,
        take: USERS_PAGE_SIZE,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      users,
      page,
      pageSize: USERS_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / USERS_PAGE_SIZE),
    };
  }

  // topicScores is already a native User column (the running denormalized
  // per-topic tally TopicScoreService maintains) - no separate aggregation
  // needed here, just include it as part of the plain user row.
  async getUserDetail(phone: string): Promise<UserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { phone_number: phone },
      include: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException(`User ${phone} not found`);
    }

    const recentInteractions = await this.prisma.interaction.findMany({
      where: { userId: phone },
      orderBy: { createdAt: 'desc' },
      take: RECENT_INTERACTIONS_LIMIT,
    });

    return { ...user, recentInteractions };
  }

  async updateTier(phone: string, tier: SubscriptionTier): Promise<User> {
    await this.findUserOrThrow(phone);
    return this.prisma.user.update({ where: { phone_number: phone }, data: { tier } });
  }

  private async findUserOrThrow(phone: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { phone_number: phone } });

    if (!user) {
      throw new NotFoundException(`User ${phone} not found`);
    }

    return user;
  }
}
