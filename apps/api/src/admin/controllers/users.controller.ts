import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminRole, SubscriptionTier, User } from '../../../generated/prisma';
import { AdminUsersService, PaginatedUsers, UserDetail } from '../services/admin-users.service';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { Roles } from '../auth/roles.decorator';

interface UpdateTierRequestBody {
  tier?: string;
}

@Controller('admin/users')
@UseGuards(AdminJwtGuard, AdminRoleGuard)
export class UsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  // No @Roles() here - any authenticated admin (including VIEWER) can browse
  // users; only changing a tier (below) is restricted to SUPER_ADMIN.
  @Get()
  async list(
    @Query('page') page?: string,
    @Query('search') search?: string,
    @Query('tier') tier?: string,
  ): Promise<PaginatedUsers> {
    const parsedPage = page ? Number(page) : 1;
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      throw new BadRequestException('page must be a positive integer');
    }

    const parsedTier = tier ? this.parseTier(tier) : undefined;

    return this.adminUsersService.listUsers(parsedPage, search, parsedTier);
  }

  @Get(':phone')
  async getOne(@Param('phone') phone: string): Promise<UserDetail> {
    return this.adminUsersService.getUserDetail(phone);
  }

  @Patch(':phone/tier')
  @Roles(AdminRole.SUPER_ADMIN)
  async updateTier(
    @Param('phone') phone: string,
    @Body() body: UpdateTierRequestBody,
  ): Promise<User> {
    const tier = this.parseTier(body.tier);
    return this.adminUsersService.updateTier(phone, tier);
  }

  private parseTier(value?: string): SubscriptionTier {
    const validTiers = Object.values(SubscriptionTier);
    if (!value || !validTiers.includes(value as SubscriptionTier)) {
      throw new BadRequestException(`tier must be one of: ${validTiers.join(', ')}`);
    }
    return value as SubscriptionTier;
  }
}
