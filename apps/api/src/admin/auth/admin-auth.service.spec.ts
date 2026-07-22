import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminRole } from '../../../generated/prisma';
import { AdminAuthService } from './admin-auth.service';

describe('AdminAuthService', () => {
  let service: AdminAuthService;
  let findUnique: jest.Mock;
  let update: jest.Mock;
  const jwtService = new JwtService({});
  const secret = 'test-admin-jwt-secret';

  const adminId = 'admin-1';
  const email = 'admin@gcebot.test';
  const totpSecret = speakeasy.generateSecret().base32;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('CorrectHorseBatteryStaple1', 10);
  });

  beforeEach(() => {
    findUnique = jest.fn();
    update = jest.fn();

    const configService = {
      getOrThrow: jest.fn().mockReturnValue(secret),
    } as unknown as ConfigService;

    service = new AdminAuthService(
      { adminUser: { findUnique, update } } as unknown as PrismaService,
      jwtService,
      configService,
    );
  });

  function admin(overrides: Record<string, unknown> = {}) {
    return {
      id: adminId,
      email,
      passwordHash,
      totpSecret,
      role: AdminRole.SUPER_ADMIN,
      ...overrides,
    };
  }

  describe('login', () => {
    it('issues a tempToken for correct credentials with 2FA configured', async () => {
      findUnique.mockResolvedValue(admin());

      const result = await service.login(email, 'CorrectHorseBatteryStaple1');

      expect(result.requiresTotp).toBe(true);
      expect(result.tempToken).toBeDefined();
      const payload = jwtService.verify(result.tempToken!, { secret });
      expect(payload).toMatchObject({ adminId, purpose: 'totp' });
    });

    it('rejects an unknown email with the same generic message as a wrong password', async () => {
      findUnique.mockResolvedValue(null);

      await expect(service.login('nobody@gcebot.test', 'whatever')).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('rejects a wrong password', async () => {
      findUnique.mockResolvedValue(admin());

      await expect(service.login(email, 'WrongPassword')).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('refuses to log in an admin with no TOTP secret configured, rather than issuing a password-only session', async () => {
      findUnique.mockResolvedValue(admin({ totpSecret: null }));

      await expect(service.login(email, 'CorrectHorseBatteryStaple1')).rejects.toThrow(
        new UnauthorizedException('Two-factor authentication is not configured for this account'),
      );
    });
  });

  describe('verifyTotp', () => {
    function tempTokenFor(id: string, purpose: 'totp' | 'other' = 'totp') {
      return jwtService.sign({ adminId: id, purpose }, { secret, expiresIn: '5m' });
    }

    it('issues a session token for a correct code and records lastLoginAt', async () => {
      findUnique.mockResolvedValue(admin());
      const code = speakeasy.totp({ secret: totpSecret, encoding: 'base32' });

      const result = await service.verifyTotp(tempTokenFor(adminId), code);

      expect(result.admin).toEqual({ id: adminId, email, role: AdminRole.SUPER_ADMIN });
      const payload = jwtService.verify(result.token, { secret });
      expect(payload).toMatchObject({ adminId, email, role: AdminRole.SUPER_ADMIN });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: adminId },
          data: { lastLoginAt: expect.any(Date) },
        }),
      );
    });

    it('rejects an incorrect code', async () => {
      findUnique.mockResolvedValue(admin());

      await expect(service.verifyTotp(tempTokenFor(adminId), '000000')).rejects.toThrow(
        new UnauthorizedException('Invalid authentication code'),
      );
    });

    it('rejects a tempToken signed with the wrong secret', async () => {
      findUnique.mockResolvedValue(admin());
      const foreignToken = jwtService.sign(
        { adminId, purpose: 'totp' },
        { secret: 'wrong-secret' },
      );

      await expect(service.verifyTotp(foreignToken, '123456')).rejects.toThrow(
        new UnauthorizedException('Login session expired - please log in again'),
      );
    });

    it('rejects a token whose purpose is not "totp" (a real session token reused here)', async () => {
      findUnique.mockResolvedValue(admin());
      const code = speakeasy.totp({ secret: totpSecret, encoding: 'base32' });

      await expect(service.verifyTotp(tempTokenFor(adminId, 'other'), code)).rejects.toThrow(
        new UnauthorizedException('Invalid session'),
      );
    });

    it('rejects when the admin no longer has a TOTP secret (e.g. deleted between login steps)', async () => {
      findUnique.mockResolvedValue(admin({ totpSecret: null }));

      await expect(service.verifyTotp(tempTokenFor(adminId), '123456')).rejects.toThrow(
        new UnauthorizedException('Invalid session'),
      );
    });
  });
});
