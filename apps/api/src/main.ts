import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Only the admin portal (apps/admin) needs cross-origin access - the
  // WhatsApp webhook is server-to-server (Meta calling this API directly)
  // and never goes through a browser, so it doesn't need CORS at all.
  const configService = app.get(ConfigService);
  app.enableCors({ origin: configService.getOrThrow<string>('ADMIN_PORTAL_URL') });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
