import { SetMetadata } from '@nestjs/common';
import { AdminRole } from '../../../generated/prisma';

export const ROLES_KEY = 'roles';

// Applied alongside @UseGuards(AdminJwtGuard, AdminRoleGuard) on a controller
// or handler - AdminRoleGuard reads this metadata to decide which roles may
// proceed. No @Roles() at all means "any authenticated admin".
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
