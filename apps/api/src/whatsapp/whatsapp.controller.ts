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
import { Response } from 'express';
import { SignatureGuard } from './guards/signature.guard';

@Controller('webhook')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private readonly configService: ConfigService) {}

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
  @UseGuards(SignatureGuard)
  receiveWebhook(@Body() body: unknown) {
    // Payload parsing and routing land in later steps of this branch.
    this.logger.debug(`Received webhook payload: ${JSON.stringify(body)}`);
    return { received: true };
  }
}
