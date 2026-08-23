import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { SignatureGuard } from './guards/signature.guard';
import { WhatsappRateLimitGuard } from './guards/rate-limit.guard';
import { MessageParserService, WhatsAppWebhookPayload } from './services/message-parser.service';
import { MessageRouterService } from './services/message-router.service';

@Controller('webhook')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly messageParser: MessageParserService,
    private readonly messageRouter: MessageRouterService,
  ) {}

  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expectedToken = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return res.status(HttpStatus.OK).send(challenge);
    }

    this.logger.warn('Webhook verification failed: mode or verify_token mismatch');
    return res.status(HttpStatus.FORBIDDEN).send();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(SignatureGuard, WhatsappRateLimitGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  receiveWebhook(@Body() body: WhatsAppWebhookPayload) {
    const message = this.messageParser.parse(body);

    if (!message) {
      return { received: true };
    }

    this.logger.log(`Inbound ${message.type} from ${message.from}`);

    // Ack Meta immediately; process asynchronously so a slow downstream call
    // (WhatsApp API sends, DB/Redis) can't cause a webhook timeout/retry storm.
    this.messageRouter
      .route(message)
      .then(() => this.logger.log(`Handled ${message.type} from ${message.from}`))
      .catch((error: unknown) => {
        this.logger.error(`Error routing message from ${message.from}: ${error}`);
      });
    return { received: true };
  }
}
