import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RagModule } from '../rag/rag.module';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminJwtGuard } from './auth/admin-jwt.guard';
import { AdminRoleGuard } from './auth/admin-role.guard';
import { DocumentsController } from './controllers/documents.controller';

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
  ],
  // All admin-only controllers (documents/users/analytics/broadcast, as this
  // branch progresses) live directly here rather than in their own
  // sub-modules, matching WhatsappModule's own flat-controllers convention.
  controllers: [AdminAuthController, DocumentsController],
  providers: [AdminAuthService, AdminJwtGuard, AdminRoleGuard],
  exports: [AdminJwtGuard, AdminRoleGuard],
})
export class AdminModule {}
