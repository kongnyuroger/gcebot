import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '../../../generated/prisma';
import { AdminRoleGuard } from './admin-role.guard';
import { AdminRequest } from './admin-jwt.guard';

describe('AdminRoleGuard', () => {
  let getAllAndOverride: jest.Mock;
  let guard: AdminRoleGuard;

  beforeEach(() => {
    getAllAndOverride = jest.fn();
    guard = new AdminRoleGuard({ getAllAndOverride } as unknown as Reflector);
  });

  function contextFor(role: AdminRole): ExecutionContext {
    const request = { admin: { adminId: 'a1', email: 'a@gcebot.test', role } } as AdminRequest;
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => class {},
    } as unknown as ExecutionContext;
  }

  it('allows any authenticated admin when no @Roles() metadata is present', () => {
    getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextFor(AdminRole.VIEWER))).toBe(true);
  });

  it('allows any authenticated admin when @Roles() is present but empty', () => {
    getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(contextFor(AdminRole.VIEWER))).toBe(true);
  });

  it('allows a role listed in @Roles()', () => {
    getAllAndOverride.mockReturnValue([AdminRole.CONTENT_MANAGER, AdminRole.SUPER_ADMIN]);
    expect(guard.canActivate(contextFor(AdminRole.SUPER_ADMIN))).toBe(true);
  });

  it('rejects a role not listed in @Roles()', () => {
    getAllAndOverride.mockReturnValue([AdminRole.CONTENT_MANAGER, AdminRole.SUPER_ADMIN]);
    expect(() => guard.canActivate(contextFor(AdminRole.VIEWER))).toThrow(
      new ForbiddenException('Insufficient role for this action'),
    );
  });
});
