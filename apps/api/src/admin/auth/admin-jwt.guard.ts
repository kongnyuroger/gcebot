import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AdminSessionPayload } from './admin-auth.service';

export interface AdminRequest extends Request {
  admin: AdminSessionPayload;
}

@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing admin authorization token');
    }

    const token = authHeader.slice('Bearer '.length);

    let payload: Partial<AdminSessionPayload> & { purpose?: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow<string>('ADMIN_JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired admin session');
    }

    // A tempToken (TOTP step only) must never work as a real session - it
    // carries a distinct `purpose` claim and lacks email/role entirely.
    if (payload.purpose === 'totp' || !payload.email || !payload.role || !payload.adminId) {
      throw new UnauthorizedException('Invalid admin session');
    }

    request.admin = { adminId: payload.adminId, email: payload.email, role: payload.role };
    return true;
  }
}
