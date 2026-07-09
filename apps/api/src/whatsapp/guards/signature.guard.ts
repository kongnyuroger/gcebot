import {
  CanActivate,
  ExecutionContext,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

@Injectable()
export class SignatureGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const signatureHeader = request.headers['x-hub-signature-256'];

    if (typeof signatureHeader !== 'string' || !request.rawBody) {
      throw new UnauthorizedException('Missing signature');
    }

    const appSecret = this.configService.getOrThrow<string>('WHATSAPP_APP_SECRET');
    const expectedSignature =
      'sha256=' + createHmac('sha256', appSecret).update(request.rawBody).digest('hex');

    const expected = Buffer.from(expectedSignature);
    const actual = Buffer.from(signatureHeader);

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Invalid signature');
    }

    return true;
  }
}
