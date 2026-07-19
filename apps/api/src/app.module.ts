import { join } from 'path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { validateEnv } from './config/env.validation';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { SessionModule } from './session/session.module';
import { UsersModule } from './users/users.module';
import { RagModule } from './rag/rag.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '../../../.env'),
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    WhatsappModule,
    SessionModule,
    UsersModule,
    RagModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
