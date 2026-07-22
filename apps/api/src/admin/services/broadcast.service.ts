import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SUBJECTS_BY_LEVEL } from '@gcebot/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Broadcast,
  BroadcastTarget,
  Level,
  Prisma,
  SubscriptionTier,
} from '../../../generated/prisma';
import {
  BROADCAST_JOB_NAME,
  BROADCAST_QUEUE_NAME,
  BroadcastJobPayload,
} from '../queues/broadcast.queue';

const MESSAGE_MAX_LENGTH = 4096;
const HISTORY_PAGE_SIZE = 20;
const ALL_SUBJECTS = new Set(
  [...SUBJECTS_BY_LEVEL.O_LEVEL, ...SUBJECTS_BY_LEVEL.A_LEVEL].map((s) => s.name),
);

export interface CreateBroadcastInput {
  message: string;
  target: BroadcastTarget;
  targetValue?: string;
  scheduleAt?: Date;
  createdBy: string;
}

export interface PaginatedBroadcasts {
  broadcasts: Broadcast[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

@Injectable()
export class BroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BROADCAST_QUEUE_NAME) private readonly broadcastQueue: Queue<BroadcastJobPayload>,
  ) {}

  async createBroadcast(input: CreateBroadcastInput): Promise<Broadcast> {
    this.validateMessage(input.message);
    this.validateTarget(input.target, input.targetValue);

    if (input.scheduleAt && input.scheduleAt.getTime() < Date.now()) {
      throw new BadRequestException('scheduleAt must be in the future');
    }

    const totalRecipients = await this.estimateRecipients(input.target, input.targetValue);

    const broadcast = await this.prisma.broadcast.create({
      data: {
        message: input.message,
        target: input.target,
        targetValue: input.targetValue,
        scheduleAt: input.scheduleAt,
        createdBy: input.createdBy,
        totalRecipients,
      },
    });

    const delay = input.scheduleAt ? Math.max(0, input.scheduleAt.getTime() - Date.now()) : 0;
    await this.broadcastQueue.add(BROADCAST_JOB_NAME, { broadcastId: broadcast.id }, { delay });

    return broadcast;
  }

  async estimateRecipients(target: BroadcastTarget, targetValue?: string): Promise<number> {
    this.validateTarget(target, targetValue);
    return this.prisma.user.count({ where: this.buildTargetWhere(target, targetValue) });
  }

  async getHistory(page = 1): Promise<PaginatedBroadcasts> {
    const [broadcasts, total] = await Promise.all([
      this.prisma.broadcast.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * HISTORY_PAGE_SIZE,
        take: HISTORY_PAGE_SIZE,
      }),
      this.prisma.broadcast.count(),
    ]);

    return {
      broadcasts,
      page,
      pageSize: HISTORY_PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / HISTORY_PAGE_SIZE),
    };
  }

  buildTargetWhere(target: BroadcastTarget, targetValue?: string): Prisma.UserWhereInput {
    switch (target) {
      case BroadcastTarget.ALL:
        return {};
      case BroadcastTarget.TIER:
        return { tier: targetValue as SubscriptionTier };
      case BroadcastTarget.SUBJECT:
        return { subjects: { has: targetValue } };
      case BroadcastTarget.LEVEL:
        return { level: targetValue as Level };
    }
  }

  private validateMessage(message: string): void {
    if (!message || message.trim().length === 0) {
      throw new BadRequestException('message is required');
    }
    if (message.length > MESSAGE_MAX_LENGTH) {
      throw new BadRequestException(`message cannot exceed ${MESSAGE_MAX_LENGTH} characters`);
    }
  }

  private validateTarget(target: BroadcastTarget, targetValue?: string): void {
    if (target === BroadcastTarget.ALL) {
      return;
    }

    if (!targetValue) {
      throw new BadRequestException(`targetValue is required for target=${target}`);
    }

    if (
      target === BroadcastTarget.TIER &&
      !Object.values(SubscriptionTier).includes(targetValue as SubscriptionTier)
    ) {
      throw new BadRequestException(
        `targetValue must be one of: ${Object.values(SubscriptionTier).join(', ')}`,
      );
    }
    if (target === BroadcastTarget.LEVEL && !Object.values(Level).includes(targetValue as Level)) {
      throw new BadRequestException(
        `targetValue must be one of: ${Object.values(Level).join(', ')}`,
      );
    }
    if (target === BroadcastTarget.SUBJECT && !ALL_SUBJECTS.has(targetValue)) {
      throw new BadRequestException(`targetValue must be a known subject`);
    }
  }
}
