import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminRole } from '../../../generated/prisma';

// Short-lived - just long enough for an admin to read their authenticator
// app and type in a code. A leaked tempToken this short-lived, and unusable
// as a real session anyway (see AdminJwtGuard), is low risk.
const TEMP_TOKEN_EXPIRY = '5m';
const SESSION_TOKEN_EXPIRY = '4h';
// +/- 1 step (30s each) of clock drift tolerance around the current code.
const TOTP_WINDOW = 1;

export interface AdminSessionPayload {
  adminId: string;
  email: string;
  role: AdminRole;
}

export interface AdminTempTokenPayload {
  adminId: string;
  purpose: 'totp';
}

export interface LoginResult {
  requiresTotp: boolean;
  tempToken?: string;
}

export interface VerifyTotpResult {
  token: string;
  admin: { id: string; email: string; role: AdminRole };
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });

    // Same generic error whether the email doesn't exist or the password is
    // wrong - never reveals which admin emails are registered.
    if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!admin.totpSecret) {
      // Nothing to fall back to mid-login - 2FA enrollment happens via the
      // admin-seed script (or a future dedicated enrollment flow), not here.
      // Refusing outright avoids ever issuing a password-only session.
      throw new UnauthorizedException(
        'Two-factor authentication is not configured for this account',
      );
    }

    const tempTokenPayload: AdminTempTokenPayload = { adminId: admin.id, purpose: 'totp' };
    const tempToken = this.jwtService.sign(tempTokenPayload, {
      secret: this.getSecret(),
      expiresIn: TEMP_TOKEN_EXPIRY,
    });

    return { requiresTotp: true, tempToken };
  }

  async verifyTotp(tempToken: string, code: string): Promise<VerifyTotpResult> {
    const payload = this.decodeTempToken(tempToken);

    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.adminId } });
    if (!admin?.totpSecret) {
      throw new UnauthorizedException('Invalid session');
    }

    const verified = speakeasy.totp.verify({
      secret: admin.totpSecret,
      encoding: 'base32',
      token: code,
      window: TOTP_WINDOW,
    });

    if (!verified) {
      throw new UnauthorizedException('Invalid authentication code');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const sessionPayload: AdminSessionPayload = {
      adminId: admin.id,
      email: admin.email,
      role: admin.role,
    };
    const token = this.jwtService.sign(sessionPayload, {
      secret: this.getSecret(),
      expiresIn: SESSION_TOKEN_EXPIRY,
    });

    return { token, admin: { id: admin.id, email: admin.email, role: admin.role } };
  }

  private decodeTempToken(tempToken: string): AdminTempTokenPayload {
    let payload: AdminTempTokenPayload;
    try {
      payload = this.jwtService.verify<AdminTempTokenPayload>(tempToken, {
        secret: this.getSecret(),
      });
    } catch {
      throw new UnauthorizedException('Login session expired - please log in again');
    }

    if (payload.purpose !== 'totp') {
      throw new UnauthorizedException('Invalid session');
    }

    return payload;
  }

  private getSecret(): string {
    return this.configService.getOrThrow<string>('ADMIN_JWT_SECRET');
  }
}
