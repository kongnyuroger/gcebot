import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class WhatsappRateLimitGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const from = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    return typeof from === 'string' && from.length > 0 ? from : req.ip;
  }
}
