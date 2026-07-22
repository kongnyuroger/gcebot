import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RagModule } from '../rag/rag.module';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminJwtGuard } from './auth/admin-jwt.guard';
import { AdminRoleGuard } from './auth/admin-role.guard';
import { DocumentsController } from './controllers/documents.controller';
import { UsersController } from './controllers/users.controller';
import { AdminUsersService } from './services/admin-users.service';
import { AnalyticsController } from './controllers/analytics.controller';
import { AnalyticsService } from './services/analytics.service';
import { BroadcastController } from './controllers/broadcast.controller';
import { BroadcastService } from './services/broadcast.service';
import { BROADCAST_QUEUE_NAME } from './queues/broadcast.queue';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('ADMIN_JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
    RagModule, // for IngestionService, used by DocumentsController
    // Registered here (producer side, for BroadcastService to enqueue jobs)
    // AND again in WhatsappModule (consumer side, for BroadcastProcessor,
    // which needs WhatsappSendService and can't live here without a
    // circular import back to WhatsappModule) - same dual-registration
    // pattern as mock.module.ts's ingestion timer queue.
    BullModule.registerQueue({ name: BROADCAST_QUEUE_NAME }),
  ],
  // All admin-only controllers (documents/users/analytics/broadcast) live
  // directly here rather than in their own sub-modules, matching
  // WhatsappModule's own flat-controllers convention.
  controllers: [
    AdminAuthController,
    DocumentsController,
    UsersController,
    AnalyticsController,
    BroadcastController,
  ],
  providers: [
    AdminAuthService,
    AdminJwtGuard,
    AdminRoleGuard,
    AdminUsersService,
    AnalyticsService,
    BroadcastService,
  ],
  // BroadcastService is exported so WhatsappModule's BroadcastProcessor (the
  // only thing that can house it, since it needs WhatsappSendService) can
  // reuse its buildTargetWhere() - the one, shared source of truth for
  // "which users match this broadcast's target", rather than duplicating it.
  exports: [AdminJwtGuard, AdminRoleGuard, BroadcastService],
})
export class AdminModule {}
