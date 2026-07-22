import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminRole, Broadcast, BroadcastTarget } from '../../../generated/prisma';
import { BroadcastService, PaginatedBroadcasts } from '../services/broadcast.service';
import { AdminJwtGuard, AdminRequest } from '../auth/admin-jwt.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { Roles } from '../auth/roles.decorator';

interface CreateBroadcastRequestBody {
  message?: string;
  target?: string;
  targetValue?: string;
  scheduleAt?: string;
}

@Controller('admin/broadcast')
@UseGuards(AdminJwtGuard, AdminRoleGuard)
export class BroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  // Sending to potentially every user is a higher-stakes mutating action
  // than viewing - restricted the same way document ingestion is.
  @Post()
  @Roles(AdminRole.CONTENT_MANAGER, AdminRole.SUPER_ADMIN)
  async create(@Body() body: CreateBroadcastRequestBody, @Req() req: Request): Promise<Broadcast> {
    if (!body.message) {
      throw new BadRequestException('message is required');
    }
    const target = this.parseTarget(body.target);
    const scheduleAt = body.scheduleAt ? new Date(body.scheduleAt) : undefined;
    if (scheduleAt && Number.isNaN(scheduleAt.getTime())) {
      throw new BadRequestException('scheduleAt must be a valid date');
    }

    const admin = (req as AdminRequest).admin;

    return this.broadcastService.createBroadcast({
      message: body.message,
      target,
      targetValue: body.targetValue,
      scheduleAt,
      createdBy: admin.adminId,
    });
  }

  @Get('history')
  async history(@Query('page') page?: string): Promise<PaginatedBroadcasts> {
    const parsedPage = page ? Number(page) : 1;
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      throw new BadRequestException('page must be a positive integer');
    }
    return this.broadcastService.getHistory(parsedPage);
  }

  @Get('estimate')
  async estimate(
    @Query('target') targetParam?: string,
    @Query('targetValue') targetValue?: string,
  ): Promise<{ count: number }> {
    const target = this.parseTarget(targetParam);
    const count = await this.broadcastService.estimateRecipients(target, targetValue);
    return { count };
  }

  private parseTarget(value?: string): BroadcastTarget {
    const validTargets = Object.values(BroadcastTarget);
    if (!value || !validTargets.includes(value as BroadcastTarget)) {
      throw new BadRequestException(`target must be one of: ${validTargets.join(', ')}`);
    }
    return value as BroadcastTarget;
  }
}
