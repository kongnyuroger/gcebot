import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AdminRole } from '../../../generated/prisma';
import { AdminJwtGuard, AdminRequest } from './admin-jwt.guard';

describe('AdminJwtGuard', () => {
  const secret = 'test-admin-jwt-secret';
  const jwtService = new JwtService({});
  let guard: AdminJwtGuard;

  beforeEach(() => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue(secret),
    } as unknown as ConfigService;
    guard = new AdminJwtGuard(jwtService, configService);
  });

  function contextFor(request: Partial<AdminRequest>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('rejects a request with no Authorization header', () => {
    const context = contextFor({ headers: {} } as AdminRequest);
    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Missing admin authorization token'),
    );
  });

  it('rejects a header that is not a Bearer token', () => {
    const context = contextFor({ headers: { authorization: 'Basic abc123' } } as AdminRequest);
    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Missing admin authorization token'),
    );
  });

  it('rejects an invalid or expired token', () => {
    const badToken = jwtService.sign({ adminId: 'a1' }, { secret: 'wrong-secret' });
    const context = contextFor({
      headers: { authorization: `Bearer ${badToken}` },
    } as AdminRequest);
    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Invalid or expired admin session'),
    );
  });

  it('rejects a tempToken (TOTP step only) from being used as a real session', () => {
    const tempToken = jwtService.sign({ adminId: 'a1', purpose: 'totp' }, { secret });
    const context = contextFor({
      headers: { authorization: `Bearer ${tempToken}` },
    } as AdminRequest);
    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Invalid admin session'),
    );
  });

  it('rejects a session-shaped token missing required claims', () => {
    const incompleteToken = jwtService.sign({ adminId: 'a1' }, { secret });
    const context = contextFor({
      headers: { authorization: `Bearer ${incompleteToken}` },
    } as AdminRequest);
    expect(() => guard.canActivate(context)).toThrow(
      new UnauthorizedException('Invalid admin session'),
    );
  });

  it('allows a valid session token and populates request.admin', () => {
    const sessionToken = jwtService.sign(
      { adminId: 'a1', email: 'admin@gcebot.test', role: AdminRole.CONTENT_MANAGER },
      { secret },
    );
    const request = { headers: { authorization: `Bearer ${sessionToken}` } } as AdminRequest;
    const context = contextFor(request);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.admin).toEqual({
      adminId: 'a1',
      email: 'admin@gcebot.test',
      role: AdminRole.CONTENT_MANAGER,
    });
  });
});
