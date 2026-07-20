import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '../../../generated/prisma';
import { ROLES_KEY } from './roles.decorator';
import { AdminRequest } from './admin-jwt.guard';

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  // Must be listed AFTER AdminJwtGuard in @UseGuards() - NestJS runs guards
  // in array order, and this relies on request.admin already being set.
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!requiredRoles.includes(request.admin.role)) {
      throw new ForbiddenException('Insufficient role for this action');
    }

    return true;
  }
}
