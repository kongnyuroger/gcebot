import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { SignatureGuard } from './signature.guard';

describe('SignatureGuard', () => {
  const appSecret = 'test-app-secret';
  let guard: SignatureGuard;

  beforeEach(() => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue(appSecret),
    } as unknown as ConfigService;
    guard = new SignatureGuard(configService);
  });

  function buildContext(rawBody?: Buffer, signatureHeader?: string): ExecutionContext {
    const request = {
      headers: signatureHeader ? { 'x-hub-signature-256': signatureHeader } : {},
      rawBody,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  function sign(rawBody: Buffer): string {
    return 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  }

  it('passes when the signature matches', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const context = buildContext(rawBody, sign(rawBody));

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects with 401 when the signature does not match', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const context = buildContext(rawBody, 'sha256=' + '0'.repeat(64));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the signature header is missing', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const context = buildContext(rawBody, undefined);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the raw body is missing', () => {
    const context = buildContext(undefined, 'sha256=' + '0'.repeat(64));

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const wrongSignature =
      'sha256=' + createHmac('sha256', 'wrong-secret').update(rawBody).digest('hex');
    const context = buildContext(rawBody, wrongSignature);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
