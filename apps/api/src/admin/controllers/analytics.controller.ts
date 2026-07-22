import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsResult, AnalyticsService } from '../services/analytics.service';
import { AdminJwtGuard } from '../auth/admin-jwt.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';

const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BARE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// No @Roles() here - any authenticated admin (including VIEWER) can view
// analytics; nothing here mutates state.
@Controller('admin/analytics')
@UseGuards(AdminJwtGuard, AdminRoleGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  async getAnalytics(
    @Query('from') fromParam?: string,
    @Query('to') toParam?: string,
  ): Promise<AnalyticsResult> {
    // A bare "YYYY-MM-DD" (e.g. from a plain <input type="date">, as the
    // frontend's custom-range picker sends) parses via `new Date(...)` as
    // MIDNIGHT UTC - the very start of that day, not its end. Left
    // unadjusted, `createdAt <= to` would silently exclude everything that
    // happened on the `to` day itself.
    const to = toParam ? this.endOfDayIfBareDate(new Date(toParam), toParam) : new Date();
    const from = fromParam
      ? new Date(fromParam)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from/to must be valid dates');
    }
    if (from > to) {
      throw new BadRequestException('from must be before to');
    }
    if ((to.getTime() - from.getTime()) / MS_PER_DAY > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_RANGE_DAYS} days`);
    }

    return this.analyticsService.getAnalytics(from, to);
  }

  private endOfDayIfBareDate(date: Date, rawParam: string): Date {
    if (!BARE_DATE_PATTERN.test(rawParam) || Number.isNaN(date.getTime())) {
      return date;
    }
    return new Date(date.getTime() + MS_PER_DAY - 1);
  }
}
