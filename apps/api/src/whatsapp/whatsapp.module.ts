import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { MessageParserService } from './services/message-parser.service';

@Module({
  controllers: [WhatsappController],
  providers: [MessageParserService],
})
export class WhatsappModule {}
