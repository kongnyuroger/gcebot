import { Module } from '@nestjs/common';
import { StreakService } from './streak.service';
import { ProgressStatsService } from './progress-stats.service';

@Module({
  providers: [StreakService, ProgressStatsService],
  exports: [StreakService, ProgressStatsService],
})
export class ProgressModule {}
